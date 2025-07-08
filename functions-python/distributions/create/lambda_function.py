"""
Create CloudFront distribution - Python implementation
"""
import os
import json
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, extract_request_data
from aws_clients import (
    get_dynamodb_resource, 
    get_cloudfront_client, 
    get_s3_client,
    get_stepfunctions_client
)

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_default_distribution_config(name: str, origin_domain: str, origin_path: str = '') -> Dict[str, Any]:
    """
    Get default CloudFront distribution configuration
    
    Args:
        name: Distribution name
        origin_domain: Origin domain name
        origin_path: Origin path (optional)
        
    Returns:
        CloudFront distribution configuration
    """
    # Format origin path properly
    formatted_origin_path = origin_path
    if formatted_origin_path:
        if not formatted_origin_path.startswith('/'):
            formatted_origin_path = '/' + formatted_origin_path
        
        # If originPath is just '/', set it to empty string
        if formatted_origin_path == '/':
            formatted_origin_path = ''
        
        # Remove trailing slash if present (unless it's the root path)
        if len(formatted_origin_path) > 1 and formatted_origin_path.endswith('/'):
            formatted_origin_path = formatted_origin_path[:-1]
    
    return {
        'CallerReference': f"{name}-{int(datetime.utcnow().timestamp() * 1000)}",
        'Comment': name,
        'Enabled': True,
        'DefaultRootObject': 'index.html',
        'Origins': {
            'Quantity': 1,
            'Items': [
                {
                    'Id': 'default-origin',
                    'DomainName': origin_domain,
                    'OriginPath': formatted_origin_path,
                    'CustomOriginConfig': {
                        'HTTPPort': 80,
                        'HTTPSPort': 443,
                        'OriginProtocolPolicy': 'https-only',
                        'OriginSslProtocols': {
                            'Quantity': 1,
                            'Items': ['TLSv1.2']
                        },
                        'OriginReadTimeout': 30,
                        'OriginKeepaliveTimeout': 5
                    }
                }
            ]
        },
        'DefaultCacheBehavior': {
            'TargetOriginId': 'default-origin',
            'ViewerProtocolPolicy': 'redirect-to-https',
            'AllowedMethods': {
                'Quantity': 7,
                'Items': ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
                'CachedMethods': {
                    'Quantity': 3,
                    'Items': ['GET', 'HEAD', 'OPTIONS']
                }
            },
            'CachePolicyId': os.environ.get('CUSTOM_CACHE_POLICY_ID', '658327ea-f89d-4fab-a63d-7e88639e58f6'),
            'Compress': False,
            'TrustedSigners': {
                'Enabled': False,
                'Quantity': 0
            }
        },
        'PriceClass': 'PriceClass_100',
        'HttpVersion': 'http2and3'
    }

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to create CloudFront distribution
    
    Args:
        event: Lambda event dictionary
        context: Lambda context object
        
    Returns:
        API Gateway response with CORS headers
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    # Handle OPTIONS request for CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'message': 'Request body is required'
            })
        
        # Validate required fields
        name = request_data.get('name')
        
        if not name:
            return cors_response(400, {
                'success': False,
                'message': 'Missing required field: name is required'
            })
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        if not distributions_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error'
            })
        
        # Generate unique distribution ID
        distribution_id = str(uuid.uuid4())
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Check if this is a multi-origin distribution
        if request_data.get('isMultiOrigin') and request_data.get('multiOriginConfig'):
            logger.info("Creating multi-origin distribution with Lambda@Edge")
            return create_multi_origin_distribution(
                request_data, name, distribution_id, dynamodb, cloudfront, event
            )
        
        # Get distribution configuration for single-origin
        if 'config' in request_data and request_data['config']:
            # Use provided configuration
            distribution_config = request_data['config']
            
            # Ensure required fields are present
            distribution_config['CallerReference'] = f"{name}-{int(datetime.utcnow().timestamp())}"
            distribution_config['Enabled'] = distribution_config.get('Enabled', True)
            distribution_config['Comment'] = distribution_config.get('Comment', name)
            
        else:
            # Fallback to simple single-origin configuration
            origin_domain = request_data.get('originDomain', '')
            if not origin_domain:
                return cors_response(400, {
                    'success': False,
                    'message': 'Either config or originDomain is required'
                })
            
            origin_path = request_data.get('originPath', '')
            distribution_config = get_default_distribution_config(name, origin_domain, origin_path)
        
        # Override with custom cache policy if provided
        custom_cache_policy_id = os.environ.get('CUSTOM_CACHE_POLICY_ID')
        if custom_cache_policy_id:
            distribution_config['DefaultCacheBehavior']['CachePolicyId'] = custom_cache_policy_id
            distribution_config['DefaultCacheBehavior']['Compress'] = False
        
        # Create CloudFront distribution
        logger.info(f"Creating CloudFront distribution with config: {json.dumps(distribution_config, default=str)}")
        
        cf_response = cloudfront.create_distribution(
            DistributionConfig=distribution_config
        )
        
        distribution = cf_response['Distribution']
        cloudfront_id = distribution['Id']
        domain_name = distribution['DomainName']
        status = distribution['Status']
        arn = distribution['ARN']
        
        logger.info(f"Created CloudFront distribution: {cloudfront_id}")
        
        # Store distribution record in DynamoDB
        current_time = datetime.utcnow().isoformat() + 'Z'
        created_by = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'system')
        
        # Determine if this is a multi-origin distribution
        is_multi_origin = request_data.get('isMultiOrigin', False)
        if not is_multi_origin and distribution_config.get('Origins', {}).get('Items'):
            # Auto-detect multi-origin based on number of origins
            is_multi_origin = len(distribution_config['Origins']['Items']) > 1
        
        distribution_record = {
            'distributionId': distribution_id,
            'name': name,
            'cloudfrontId': cloudfront_id,
            'status': status,
            'domainName': domain_name,
            'arn': arn,
            'isMultiOrigin': is_multi_origin,
            'createdAt': current_time,
            'updatedAt': current_time,
            'createdBy': created_by,
            'config': distribution_config,
            'version': 1
        }
        
        distributions_tbl.put_item(Item=distribution_record)
        
        logger.info(f"Stored distribution record in DynamoDB: {distribution_id}")
        
        # Start status monitoring workflow if Step Functions is configured
        state_machine_arn = os.environ.get('STATUS_MONITOR_STATE_MACHINE_ARN')
        if state_machine_arn:
            try:
                stepfunctions = get_stepfunctions_client()
                stepfunctions.start_execution(
                    stateMachineArn=state_machine_arn,
                    input=json.dumps({
                        'distributionId': distribution_id,
                        'cloudfrontId': cloudfront_id,
                        'action': 'monitor_deployment'
                    })
                )
                logger.info("Started status monitoring workflow")
            except Exception as sf_error:
                logger.warning(f"Could not start status monitoring: {sf_error}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'distribution': {
                    'id': distribution_id,
                    'cloudfrontId': cloudfront_id,
                    'name': name,
                    'status': status,
                    'domainName': domain_name,
                    'arn': arn,
                    'createdAt': current_time,
                    'createdBy': created_by
                }
            },
            'message': f'Distribution {name} created successfully'
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error creating distribution: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to create distribution',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error creating distribution: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error creating distribution',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })


def create_multi_origin_distribution(request_data, name, distribution_id, dynamodb, cloudfront, event):
    """
    Create a multi-origin distribution with Lambda@Edge function
    """
    try:
        logger.info(f"Creating multi-origin distribution: {name}")
        
        multi_origin_config = request_data['multiOriginConfig']
        config = request_data['config']
        
        # Get user info
        created_by = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'system')
        
        # 1. Validate origins exist in DynamoDB
        origins = validate_origins(multi_origin_config, dynamodb)
        logger.info(f"Validated {len(origins['all'])} origins for multi-origin distribution")
        
        # 2. Create Origin Access Identity (OAI) for Lambda@Edge compatibility
        oai = create_origin_access_identity(name, cloudfront)
        logger.info(f"Created OAI for multi-origin distribution: {oai['id']}")
        
        # 3. Create Lambda@Edge function
        lambda_edge_function = create_lambda_edge_function({
            'name': f"{name}-multi-origin",
            'origins': origins,
            'preset': multi_origin_config.get('preset', 'geographic'),
            'createdBy': created_by
        })
        logger.info(f"Created Lambda@Edge function: {lambda_edge_function['functionId']}")
        
        # 4. Create CloudFront distribution configuration with Lambda@Edge
        distribution_config = build_multi_origin_distribution_config(
            name, config, origins, oai, lambda_edge_function
        )
        
        # 5. Create CloudFront distribution
        logger.info("Creating CloudFront distribution with Lambda@Edge")
        cf_response = cloudfront.create_distribution(DistributionConfig=distribution_config)
        
        distribution = cf_response['Distribution']
        cloudfront_id = distribution['Id']
        domain_name = distribution['DomainName']
        status = distribution['Status']
        arn = distribution['ARN']
        
        logger.info(f"Created CloudFront distribution: {cloudfront_id}")
        
        # 6. Update S3 bucket policies for all origins to allow OAI access
        update_s3_bucket_policies_for_oai(origins['all'], oai['id'], arn)
        
        # 7. Update origin associations in DynamoDB
        update_origin_associations(origins['all'], arn, dynamodb)
        
        # 8. Store distribution record in DynamoDB
        distribution_record = create_distribution_record(
            distribution_id, name, cloudfront_id, status, domain_name, arn,
            True, multi_origin_config, lambda_edge_function, oai, created_by, distribution_config
        )
        
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        distributions_tbl = dynamodb.Table(distributions_table)
        distributions_tbl.put_item(Item=distribution_record)
        
        logger.info(f"Stored multi-origin distribution record: {distribution_id}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'distribution': {
                    'id': distribution_id,
                    'name': name,
                    'cloudfrontId': cloudfront_id,
                    'status': status,
                    'domainName': domain_name,
                    'arn': arn,
                    'isMultiOrigin': True,
                    'lambdaEdgeFunctionId': lambda_edge_function['functionId'],
                    'oaiId': oai['id']
                }
            },
            'message': f'Multi-origin distribution {name} created successfully with Lambda@Edge'
        })
        
    except Exception as error:
        logger.error(f'Error creating multi-origin distribution: {str(error)}')
        return cors_response(500, {
            'success': False,
            'message': 'Error creating multi-origin distribution',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })


def validate_origins(multi_origin_config, dynamodb):
    """
    Validate that all origins exist in DynamoDB and return origin data
    """
    origins_table = os.environ.get('ORIGINS_TABLE')
    if not origins_table:
        raise Exception('ORIGINS_TABLE environment variable not set')
        
    origins_tbl = dynamodb.Table(origins_table)
    
    # Get default origin
    default_origin_id = multi_origin_config.get('defaultOriginId')
    if not default_origin_id:
        raise Exception('Default origin ID is required for multi-origin distribution')
        
    default_origin_response = origins_tbl.get_item(Key={'originId': default_origin_id})
    if 'Item' not in default_origin_response:
        raise Exception(f'Default origin {default_origin_id} not found')
        
    default_origin = default_origin_response['Item']
    
    # Get additional origins
    additional_origin_ids = multi_origin_config.get('additionalOriginIds', [])
    additional_origins = []
    
    for origin_id in additional_origin_ids:
        origin_response = origins_tbl.get_item(Key={'originId': origin_id})
        if 'Item' not in origin_response:
            raise Exception(f'Additional origin {origin_id} not found')
        additional_origins.append(origin_response['Item'])
    
    all_origins = [default_origin] + additional_origins
    
    return {
        'default': default_origin,
        'additional': additional_origins,
        'all': all_origins
    }


def create_origin_access_identity(distribution_name, cloudfront):
    """
    Create Origin Access Identity for multi-origin distribution
    """
    try:
        logger.info(f"Creating Origin Access Identity for distribution: {distribution_name}")
        
        oai_params = {
            'CloudFrontOriginAccessIdentityConfig': {
                'CallerReference': f"{distribution_name}-oai-{int(datetime.utcnow().timestamp())}",
                'Comment': f"OAI for multi-origin distribution: {distribution_name}"
            }
        }
        
        oai_result = cloudfront.create_cloud_front_origin_access_identity(**oai_params)
        logger.info(f"Created OAI: {oai_result['CloudFrontOriginAccessIdentity']['Id']}")
        
        return {
            'id': oai_result['CloudFrontOriginAccessIdentity']['Id'],
            's3CanonicalUserId': oai_result['CloudFrontOriginAccessIdentity']['S3CanonicalUserId']
        }
        
    except Exception as error:
        logger.error(f'Error creating OAI: {str(error)}')
        raise error


def create_lambda_edge_function(params):
    """
    Create Lambda@Edge function for multi-origin routing
    """
    try:
        from aws_clients import get_lambda_client
        import zipfile
        import io
        
        # Initialize Lambda client for us-east-1 (required for Lambda@Edge)
        lambda_client = get_lambda_client('us-east-1')
        
        # Generate function name and ID
        function_name = f"{params['name']}-func-{uuid.uuid4().hex[:8]}"
        function_id = f"func-{uuid.uuid4().hex[:8]}"
        
        # Generate Lambda@Edge function code
        function_code = generate_lambda_edge_code(params['origins'], params.get('preset', 'geographic'))
        
        # Create ZIP file for Lambda function
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            zip_file.writestr('index.js', function_code)
        zip_buffer.seek(0)
        
        # Get Lambda@Edge execution role ARN
        lambda_edge_role_arn = os.environ.get('LAMBDA_EDGE_EXECUTION_ROLE_ARN')
        if not lambda_edge_role_arn:
            raise Exception('LAMBDA_EDGE_EXECUTION_ROLE_ARN environment variable not set')
        
        # Create Lambda function
        lambda_params = {
            'FunctionName': function_name,
            'Runtime': 'nodejs18.x',
            'Role': lambda_edge_role_arn,
            'Handler': 'index.handler',
            'Code': {'ZipFile': zip_buffer.getvalue()},
            'Description': 'Lambda@Edge function for multi-origin routing',
            'Timeout': 5,
            'MemorySize': 128,
            'Publish': True  # Required for Lambda@Edge association
        }
        
        lambda_result = lambda_client.create_function(**lambda_params)
        logger.info(f"Created Lambda@Edge function: {function_name}")
        logger.info(f"Lambda result ARN: {lambda_result['FunctionArn']}")
        logger.info(f"Lambda result Version: {lambda_result.get('Version', 'Unknown')}")
        
        # Since Publish=True, the FunctionArn should already be versioned
        # But let's ensure we have the correct versioned ARN format
        function_arn = lambda_result['FunctionArn']
        version = lambda_result.get('Version', '1')
        
        # Ensure we have a versioned ARN
        if not function_arn.endswith(f':{version}'):
            versioned_arn = f"{function_arn}:{version}"
        else:
            versioned_arn = function_arn
            
        logger.info(f"Using versioned ARN: {versioned_arn}")
        
        # Wait for function to become active
        wait_for_function_active(lambda_client, function_name)
        
        # Add CloudFront invoke permission
        lambda_client.add_permission(
            FunctionName=function_name,
            StatementId=f"cloudfront-invoke-{int(datetime.utcnow().timestamp())}",
            Action='lambda:InvokeFunction',
            Principal='edgelambda.amazonaws.com'
        )
        
        # Store function metadata in DynamoDB
        store_lambda_edge_function_metadata(function_id, function_name, lambda_result, params)
        
        return {
            'functionId': function_id,
            'functionName': function_name,
            'versionArn': versioned_arn,
            'status': 'Active'
        }
        
    except Exception as error:
        logger.error(f'Error creating Lambda@Edge function: {str(error)}')
        raise error


def generate_lambda_edge_code(origins, preset='geographic'):
    """
    Generate Lambda@Edge function code for multi-origin routing with per-request computation
    """
    # Build origin mapping
    origin_mapping = {}
    for origin in origins['all']:
        region = origin['region']
        origin_id = origin['originId']
        domain_name = f"{origin['bucketName']}.s3.{region}.amazonaws.com"
        
        origin_mapping[origin_id] = {
            'domainName': domain_name,
            'region': region,
            'bucketName': origin['bucketName']
        }
    
    # Determine routing strategy based on preset
    routing_strategy = get_routing_strategy(preset, origins['all'])
    
    # Generate the Lambda@Edge function code with per-request computation
    function_code = f'''
exports.handler = async (event) => {{
    const request = event.Records[0].cf.request;
    const headers = request.headers;
    
    // Origin mapping configuration
    const origins = {json.dumps(origin_mapping, indent=4)};
    
    // Default origin
    const defaultOriginId = '{origins['default']['originId']}';
    
    // Helper function to find closest origin (computed per request)
    const findClosestOrigin = (preferredRegions) => {{
        for (const region of preferredRegions) {{
            for (const [originId, originData] of Object.entries(origins)) {{
                if (originData.region === region) {{
                    console.log(`Found origin ${{originId}} for region ${{region}}`);
                    return originId;
                }}
            }}
        }}
        console.log(`No origin found for regions ${{preferredRegions.join(', ')}}, using default: ${{defaultOriginId}}`);
        return defaultOriginId;
    }};
    
    // Get country from CloudFront headers
    const country = headers['cloudfront-viewer-country'] ? 
        headers['cloudfront-viewer-country'][0].value : 'US';
    
    console.log(`Request from country: ${{country}}`);
    
    // Enhanced country to region mapping
    const countryToRegion = {{
        // North America
        'US': 'us-east-1',
        'CA': 'us-east-1',
        'MX': 'us-east-1',
        
        // Europe
        'GB': 'eu-west-1',
        'IE': 'eu-west-1',
        'FR': 'eu-west-1',
        'ES': 'eu-west-1',
        'IT': 'eu-west-1',
        'NL': 'eu-west-1',
        'BE': 'eu-west-1',
        'PT': 'eu-west-1',
        'DE': 'eu-central-1',
        'AT': 'eu-central-1',
        'CH': 'eu-central-1',
        'PL': 'eu-central-1',
        'CZ': 'eu-central-1',
        'HU': 'eu-central-1',
        'SK': 'eu-central-1',
        'SI': 'eu-central-1',
        
        // Asia Pacific
        'JP': 'ap-northeast-1',
        'KR': 'ap-northeast-1',
        'CN': 'ap-northeast-1',
        'TW': 'ap-northeast-1',
        'SG': 'ap-southeast-1',
        'MY': 'ap-southeast-1',
        'TH': 'ap-southeast-1',
        'ID': 'ap-southeast-1',
        'PH': 'ap-southeast-1',
        'VN': 'ap-southeast-1',
        'HK': 'ap-southeast-1',
        'AU': 'ap-southeast-1',
        'NZ': 'ap-southeast-1',
        'IN': 'ap-southeast-1'
    }};
    
    const targetRegion = countryToRegion[country] || 'us-east-1';
    console.log(`Target region for ${{country}}: ${{targetRegion}}`);
    
    // Dynamic region preference mapping (computed per request)
    const getRegionPreferences = (region) => {{
        const preferences = {{
            'us-east-1': ['us-east-1', 'us-west-2', 'eu-west-1'],
            'us-west-2': ['us-west-2', 'us-east-1', 'ap-southeast-1'],
            'eu-west-1': ['eu-west-1', 'eu-central-1', 'us-east-1'],
            'eu-central-1': ['eu-central-1', 'eu-west-1', 'us-east-1'],
            'ap-northeast-1': ['ap-northeast-1', 'ap-southeast-1', 'us-east-1'],
            'ap-southeast-1': ['ap-southeast-1', 'ap-northeast-1', 'us-east-1'],
            'ap-south-1': ['ap-south-1', 'ap-southeast-1', 'ap-northeast-1'],
            'sa-east-1': ['sa-east-1', 'us-east-1', 'us-west-2']
        }};
        
        return preferences[region] || ['us-east-1'];
    }};
    
    const preferredRegions = getRegionPreferences(targetRegion);
    console.log(`Preferred regions for ${{targetRegion}}: ${{preferredRegions.join(', ')}}`);
    
    const targetOriginId = findClosestOrigin(preferredRegions);
    console.log(`Selected origin: ${{targetOriginId}}`);
    
    // Set the target origin
    const targetOrigin = origins[targetOriginId];
    if (targetOrigin) {{
        request.origin.s3.authMethod = 'origin-access-identity';
        request.origin.s3.domainName = targetOrigin.domainName;
        request.origin.s3.region = targetOrigin.region;
        request.headers['host'] = [{{ key: 'host', value: targetOrigin.domainName }}];
        
        console.log(`Routing request to origin: ${{targetOriginId}} (${{targetOrigin.region}}) - ${{targetOrigin.domainName}}`);
    }} else {{
        console.log(`Using default origin: ${{defaultOriginId}}`);
    }}
    
    return request;
}};
'''
    
    return function_code


def get_routing_strategy(preset, origins):
    """
    Determine routing strategy based on preset and available origins
    """
    available_regions = set(origin['region'] for origin in origins)
    
    strategies = {
        'geographic': {
            'name': 'Geographic Routing',
            'description': 'Route based on user geographic location',
            'regions': available_regions
        },
        'performance': {
            'name': 'Performance Optimized',
            'description': 'Route to fastest responding origin',
            'regions': available_regions
        },
        'cost': {
            'name': 'Cost Optimized',
            'description': 'Route to most cost-effective origin',
            'regions': available_regions
        },
        'global-3-region': {
            'name': 'Global 3-Region Strategy',
            'description': 'Optimized for US, Europe, and Asia Pacific',
            'regions': available_regions
        },
        'asia-us': {
            'name': 'Asia-US Strategy',
            'description': 'Optimized for Asia Pacific and US regions',
            'regions': available_regions
        }
    }
    
    return strategies.get(preset, strategies['geographic'])


def wait_for_function_active(lambda_client, function_name, max_wait_time=60):
    """
    Wait for Lambda function to become active
    """
    import time
    
    start_time = time.time()
    logger.info(f"Waiting for Lambda function {function_name} to become active...")
    
    while time.time() - start_time < max_wait_time:
        try:
            result = lambda_client.get_function(FunctionName=function_name)
            state = result['Configuration']['State']
            
            logger.info(f"Function state: {state}")
            
            if state == 'Active':
                logger.info(f"Lambda function {function_name} is now active")
                return True
            
            # Wait 2 seconds before checking again
            time.sleep(2)
            
        except Exception as error:
            logger.error(f'Error checking function state: {error}')
            raise error
    
    raise Exception(f'Lambda function {function_name} did not become active within {max_wait_time}s')


def store_lambda_edge_function_metadata(function_id, function_name, lambda_result, params):
    """
    Store Lambda@Edge function metadata in DynamoDB
    """
    try:
        lambda_edge_table = os.environ.get('LAMBDA_EDGE_FUNCTIONS_TABLE')
        if not lambda_edge_table:
            logger.warning('LAMBDA_EDGE_FUNCTIONS_TABLE not set, skipping metadata storage')
            return
        
        from aws_clients import get_dynamodb_resource
        dynamodb = get_dynamodb_resource()
        lambda_edge_tbl = dynamodb.Table(lambda_edge_table)
        
        current_time = datetime.utcnow().isoformat() + 'Z'
        
        function_record = {
            'functionId': function_id,
            'functionName': function_name,
            'functionArn': lambda_result['FunctionArn'],
            'versionArn': versioned_arn,
            'status': 'Active',
            'preset': params.get('preset', 'geographic'),
            'origins': params['origins'],
            'createdAt': current_time,
            'updatedAt': current_time,
            'createdBy': params.get('createdBy', 'system')
        }
        
        lambda_edge_tbl.put_item(Item=function_record)
        logger.info(f"Stored Lambda@Edge function metadata: {function_id}")
        
    except Exception as error:
        logger.warning(f'Could not store Lambda@Edge function metadata: {error}')
        # Don't fail the entire process for metadata storage issues


def build_multi_origin_distribution_config(name, config, origins, oai, lambda_edge_function):
    """
    Build CloudFront distribution configuration for multi-origin with Lambda@Edge
    """
    return {
        **config,
        'CallerReference': f"{name}-{int(datetime.utcnow().timestamp())}",
        'Comment': config.get('Comment', f"{name} - Multi-Origin Distribution"),
        'Enabled': config.get('Enabled', True),
        
        # Configure all origins with the same OAI
        'Origins': {
            'Quantity': len(origins['all']),
            'Items': [{
                'Id': origin['originId'],
                'DomainName': f"{origin['bucketName']}.s3.{origin['region']}.amazonaws.com",
                'OriginPath': '',
                'S3OriginConfig': {
                    'OriginAccessIdentity': f"origin-access-identity/cloudfront/{oai['id']}"
                },
                'ConnectionAttempts': 3,
                'ConnectionTimeout': 10,
                'OriginShield': {
                    'Enabled': False
                }
            } for origin in origins['all']]
        },
        
        # Configure default cache behavior with Lambda@Edge
        'DefaultCacheBehavior': {
            'TargetOriginId': origins['default']['originId'],
            'ViewerProtocolPolicy': config.get('DefaultCacheBehavior', {}).get('ViewerProtocolPolicy', 'redirect-to-https'),
            'AllowedMethods': {
                'Quantity': 2,
                'Items': ['GET', 'HEAD'],
                'CachedMethods': {
                    'Quantity': 2,
                    'Items': ['GET', 'HEAD']
                }
            },
            'CachePolicyId': os.environ.get('CUSTOM_CACHE_POLICY_ID', '658327ea-f89d-4fab-a63d-7e88639e58f6'),
            'Compress': False,
            
            # Associate Lambda@Edge function
            'LambdaFunctionAssociations': {
                'Quantity': 1,
                'Items': [{
                    'LambdaFunctionARN': lambda_edge_function['versionArn'],
                    'EventType': 'origin-request',
                    'IncludeBody': False
                }]
            },
            
            'TrustedSigners': {
                'Enabled': False,
                'Quantity': 0
            },
            'TrustedKeyGroups': {
                'Enabled': False,
                'Quantity': 0
            }
        }
    }


def update_s3_bucket_policies_for_oai(origins, oai_id, distribution_arn):
    """
    Update S3 bucket policies to allow OAI access
    """
    try:
        from aws_clients import get_s3_client
        
        for origin in origins:
            bucket_name = origin['bucketName']
            region = origin['region']
            
            try:
                s3_client = get_s3_client(region)
                
                # Get existing bucket policy
                existing_policy = None
                try:
                    policy_response = s3_client.get_bucket_policy(Bucket=bucket_name)
                    existing_policy = json.loads(policy_response['Policy'])
                except s3_client.exceptions.NoSuchBucketPolicy:
                    existing_policy = {
                        "Version": "2012-10-17",
                        "Statement": []
                    }
                
                # Create OAI statement
                oai_statement = {
                    "Sid": "AllowOriginAccessIdentities",
                    "Effect": "Allow",
                    "Principal": {
                        "AWS": f"arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity {oai_id}"
                    },
                    "Action": "s3:GetObject",
                    "Resource": f"arn:aws:s3:::{bucket_name}/*"
                }
                
                # Clean up existing policy - remove invalid OAC statements and merge OAI statements
                cleaned_statements = []
                oai_principals = set()
                
                for stmt in existing_policy['Statement']:
                    # Skip invalid OAC statements with empty conditions
                    if (stmt.get('Sid') == 'AllowCloudFrontServicePrincipal' and 
                        stmt.get('Condition', {}).get('StringEquals', {}).get('AWS:SourceArn') == []):
                        logger.info(f"Removing invalid OAC statement with empty condition from {bucket_name}")
                        continue
                    
                    # Handle existing OAI statements
                    if stmt.get('Sid') == 'AllowOriginAccessIdentities':
                        principal_aws = stmt.get('Principal', {}).get('AWS')
                        if isinstance(principal_aws, str):
                            oai_principals.add(principal_aws)
                        elif isinstance(principal_aws, list):
                            oai_principals.update(principal_aws)
                        continue
                    
                    # Keep other statements
                    cleaned_statements.append(stmt)
                
                # Add the new OAI principal
                new_oai_principal = f"arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity {oai_id}"
                oai_principals.add(new_oai_principal)
                
                # Create consolidated OAI statement
                if len(oai_principals) == 1:
                    oai_statement['Principal']['AWS'] = list(oai_principals)[0]
                else:
                    oai_statement['Principal']['AWS'] = list(oai_principals)
                
                # Add the OAI statement
                cleaned_statements.append(oai_statement)
                
                # Update the policy
                updated_policy = {
                    "Version": "2012-10-17",
                    "Statement": cleaned_statements
                }
                
                # Apply the updated policy
                s3_client.put_bucket_policy(
                    Bucket=bucket_name,
                    Policy=json.dumps(updated_policy)
                )
                
                logger.info(f"Updated S3 bucket policy for {bucket_name} with OAI access (cleaned invalid statements)")
                
            except Exception as bucket_error:
                logger.error(f"Error updating bucket policy for {bucket_name}: {bucket_error}")
                # Continue with other buckets
                continue
            
    except Exception as error:
        logger.error(f'Error updating S3 bucket policies: {str(error)}')
        # Don't fail the entire distribution creation for bucket policy issues


def update_origin_associations(origins, distribution_arn, dynamodb):
    """
    Update origin associations in DynamoDB
    """
    try:
        origins_table = os.environ.get('ORIGINS_TABLE')
        if not origins_table:
            return
            
        origins_tbl = dynamodb.Table(origins_table)
        
        for origin in origins:
            try:
                # Add distribution ARN to origin's associated distributions
                origins_tbl.update_item(
                    Key={'originId': origin['originId']},
                    UpdateExpression='ADD associatedDistributions :dist_arn SET updatedAt = :updated_at',
                    ExpressionAttributeValues={
                        ':dist_arn': {distribution_arn},
                        ':updated_at': datetime.utcnow().isoformat() + 'Z'
                    }
                )
                logger.info(f"Updated origin {origin['originId']} association with distribution")
                
            except Exception as origin_error:
                logger.warning(f"Could not update origin {origin['originId']} association: {origin_error}")
                continue
                
    except Exception as error:
        logger.warning(f'Could not update origin associations: {error}')


def create_distribution_record(distribution_id, name, cloudfront_id, status, domain_name, arn,
                             is_multi_origin, multi_origin_config, lambda_edge_function, oai, 
                             created_by, distribution_config):
    """
    Create distribution record for DynamoDB
    """
    current_time = datetime.utcnow().isoformat() + 'Z'
    
    return {
        'distributionId': distribution_id,
        'name': name,
        'cloudfrontId': cloudfront_id,
        'status': status,
        'domainName': domain_name,
        'arn': arn,
        'isMultiOrigin': is_multi_origin,
        'multiOriginConfig': multi_origin_config,
        'lambdaEdgeFunctionId': lambda_edge_function['functionId'],
        'lambdaEdgeFunctionName': lambda_edge_function['functionName'],
        'oaiId': oai['id'],
        'createdAt': current_time,
        'updatedAt': current_time,
        'createdBy': created_by,
        'config': distribution_config,
        'version': 1
    }
