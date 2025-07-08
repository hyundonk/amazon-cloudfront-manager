"""
Create Lambda@Edge function - Python implementation
"""
import os
import json
import logging
import uuid
import time
import zipfile
import io
from datetime import datetime
from typing import Dict, Any, List
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, extract_request_data
from aws_clients import get_dynamodb_resource, get_lambda_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Region mapping presets
REGION_MAPPING_PRESETS = {
    'asia-us': {
        'name': 'Asia-Pacific + Americas',
        'description': '2-origin setup: Asia-Pacific regions + Rest of world',
        'requiredOrigins': 2,
        'mapping': {
            # Asia-Pacific regions -> origin1
            'ap-east-1': 'origin1',
            'ap-northeast-1': 'origin1',
            'ap-northeast-2': 'origin1',
            'ap-northeast-3': 'origin1',
            'ap-south-1': 'origin1',
            'ap-south-2': 'origin1',
            'ap-southeast-1': 'origin1',
            'ap-southeast-2': 'origin1',
            'ap-southeast-3': 'origin1',
            'ap-southeast-4': 'origin1',
            'ap-southeast-5': 'origin1',
            'ap-southeast-7': 'origin1',
            'me-central-1': 'origin1',
            
            # Rest of world -> origin2
            'us-east-1': 'origin2',
            'us-east-2': 'origin2',
            'us-west-1': 'origin2',
            'us-west-2': 'origin2',
            'ca-central-1': 'origin2',
            'ca-west-1': 'origin2',
            'eu-central-1': 'origin2',
            'eu-central-2': 'origin2',
            'eu-north-1': 'origin2',
            'eu-south-1': 'origin2',
            'eu-south-2': 'origin2',
            'eu-west-1': 'origin2',
            'eu-west-2': 'origin2',
            'eu-west-3': 'origin2',
            'af-south-1': 'origin2',
            'il-central-1': 'origin2',
            'me-south-1': 'origin2',
            'mx-central-1': 'origin2',
            'sa-east-1': 'origin2'
        }
    },
    
    'global-three': {
        'name': 'Global 3-Region',
        'description': '3-origin setup: Asia-Pacific, Americas, Europe+Others',
        'requiredOrigins': 3,
        'mapping': {
            # Asia-Pacific -> origin1
            'ap-east-1': 'origin1',
            'ap-northeast-1': 'origin1',
            'ap-northeast-2': 'origin1',
            'ap-northeast-3': 'origin1',
            'ap-south-1': 'origin1',
            'ap-south-2': 'origin1',
            'ap-southeast-1': 'origin1',
            'ap-southeast-2': 'origin1',
            'ap-southeast-3': 'origin1',
            'ap-southeast-4': 'origin1',
            'ap-southeast-5': 'origin1',
            'ap-southeast-7': 'origin1',
            'me-central-1': 'origin1',
            
            # Americas -> origin2
            'us-east-1': 'origin2',
            'us-east-2': 'origin2',
            'us-west-1': 'origin2',
            'us-west-2': 'origin2',
            'ca-central-1': 'origin2',
            'ca-west-1': 'origin2',
            'mx-central-1': 'origin2',
            'sa-east-1': 'origin2',
            
            # Europe and Others -> origin3
            'eu-central-1': 'origin3',
            'eu-central-2': 'origin3',
            'eu-north-1': 'origin3',
            'eu-south-1': 'origin3',
            'eu-south-2': 'origin3',
            'eu-west-1': 'origin3',
            'eu-west-2': 'origin3',
            'eu-west-3': 'origin3',
            'af-south-1': 'origin3',
            'il-central-1': 'origin3',
            'me-south-1': 'origin3'
        }
    }
}

def generate_function_code(origins: Dict[str, Any], preset: str) -> str:
    """
    Generate Lambda@Edge function code
    
    Args:
        origins: Origins configuration with default and additional origins
        preset: Region mapping preset name
        
    Returns:
        Generated JavaScript code for Lambda@Edge function
    """
    preset_config = REGION_MAPPING_PRESETS.get(preset)
    if not preset_config:
        raise ValueError(f"Invalid preset: {preset}")
    
    default_origin = origins['default']
    additional_origins = origins['additional']
    
    # Validate origin count matches preset requirements
    if len(additional_origins) + 1 < preset_config['requiredOrigins']:
        raise ValueError(f"Preset {preset} requires {preset_config['requiredOrigins']} origins, but only {len(additional_origins) + 1} provided")
    
    # Generate bucket variable declarations
    bucket_declarations = [
        f"const defaultBucket = '{default_origin['domainName']}';"
    ]
    
    for index, origin in enumerate(additional_origins):
        bucket_declarations.append(f"const origin{index + 1}Bucket = '{origin['domainName']}';")
    
    # Create region mapping with actual bucket names
    actual_mapping = {}
    for region, origin_key in preset_config['mapping'].items():
        if origin_key == 'origin1' and len(additional_origins) > 0:
            actual_mapping[region] = additional_origins[0]['domainName']
        elif origin_key == 'origin2' and len(additional_origins) > 1:
            actual_mapping[region] = additional_origins[1]['domainName']
        elif origin_key == 'origin3' and len(additional_origins) > 2:
            actual_mapping[region] = additional_origins[2]['domainName']
        else:
            actual_mapping[region] = default_origin['domainName']
    
    # Generate the Lambda@Edge function code
    code = f"""
// Generated Lambda@Edge function for multi-origin routing
// Preset: {preset} ({preset_config['name']})
// Generated at: {datetime.utcnow().isoformat()}Z

{chr(10).join(bucket_declarations)}

const regionsMapping = {json.dumps(actual_mapping, indent=2)};

exports.handler = async (event) => {{
    const request = event.Records[0].cf.request;
    const region = process.env.AWS_REGION;
    
    try {{
        console.log('Lambda@Edge execution region:', region);
        console.log('Request URI:', request.uri);
        
        // Get target origin based on region
        const domainName = regionsMapping[region] || defaultBucket;
        console.log('Selected origin:', domainName);
        
        setRequestOrigin(request, domainName);
    }} catch (error) {{
        console.error('Error processing request:', error.message || error);
        // Fallback to default origin on error
        setRequestOrigin(request, defaultBucket);
    }}
    
    return request;
}};

const setRequestOrigin = (request, domainName) => {{
    request.origin.s3.authMethod = 'origin-access-identity';
    request.origin.s3.domainName = domainName;
    request.origin.s3.region = domainName.split('.')[2];
    request.headers['host'] = [{{ key: 'host', value: domainName }}];
}};
    """.strip()
    
    return code

def wait_for_function_active(lambda_client, function_name: str, max_wait_time: int = 60) -> bool:
    """
    Wait for Lambda function to become active
    
    Args:
        lambda_client: Lambda client
        function_name: Name of the Lambda function
        max_wait_time: Maximum wait time in seconds
        
    Returns:
        True if function becomes active, raises exception if timeout
    """
    start_time = time.time()
    
    logger.info(f"Waiting for Lambda function {function_name} to become active...")
    
    while time.time() - start_time < max_wait_time:
        try:
            response = lambda_client.get_function(FunctionName=function_name)
            state = response['Configuration']['State']
            
            logger.info(f"Function state: {state}")
            
            if state == 'Active':
                logger.info(f"Lambda function {function_name} is now active")
                return True
            
            # Wait 2 seconds before checking again
            time.sleep(2)
            
        except Exception as error:
            logger.error(f"Error checking function state: {error}")
            raise error
    
    raise Exception(f"Lambda function {function_name} did not become active within {max_wait_time} seconds")

def create_lambda_function(lambda_client, function_name: str, code: str) -> Dict[str, Any]:
    """
    Create Lambda@Edge function in AWS
    
    Args:
        lambda_client: Lambda client
        function_name: Name for the Lambda function
        code: JavaScript code for the function
        
    Returns:
        Lambda function creation response
    """
    # Create proper ZIP file
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        zip_file.writestr('index.js', code)
    zip_buffer.seek(0)
    
    # Get execution role ARN
    execution_role_arn = os.environ.get('LAMBDA_EDGE_EXECUTION_ROLE_ARN')
    if not execution_role_arn:
        raise ValueError('LAMBDA_EDGE_EXECUTION_ROLE_ARN environment variable not set')
    
    params = {
        'FunctionName': function_name,
        'Runtime': 'nodejs18.x',
        'Role': execution_role_arn,
        'Handler': 'index.handler',
        'Code': {
            'ZipFile': zip_buffer.getvalue()
        },
        'Description': 'Lambda@Edge function for multi-origin routing',
        'Timeout': 5,
        'MemorySize': 128,
        'Publish': True  # Required for Lambda@Edge
    }
    
    try:
        result = lambda_client.create_function(**params)
        logger.info(f"Lambda function created: {result['FunctionArn']}")
        
        # Wait for function to become active
        wait_for_function_active(lambda_client, function_name)
        
        # Add CloudFront invoke permission
        lambda_client.add_permission(
            FunctionName=function_name,
            StatementId=f"cloudfront-invoke-{int(time.time() * 1000)}",
            Action='lambda:InvokeFunction',
            Principal='edgelambda.amazonaws.com'
        )
        
        logger.info("CloudFront invoke permission added")
        
        return result
        
    except Exception as error:
        logger.error(f"Error creating Lambda function: {error}")
        raise error

def save_function_record(dynamodb, function_data: Dict[str, Any]) -> None:
    """
    Save Lambda@Edge function record to DynamoDB
    
    Args:
        dynamodb: DynamoDB resource
        function_data: Function data to save
    """
    lambda_edge_table = os.environ.get('LAMBDA_EDGE_FUNCTIONS_TABLE')
    if not lambda_edge_table:
        raise ValueError('LAMBDA_EDGE_FUNCTIONS_TABLE environment variable not set')
    
    table = dynamodb.Table(lambda_edge_table)
    
    item = {
        'functionId': function_data['functionId'],
        'functionName': function_data['functionName'],
        'functionArn': function_data['functionArn'],
        'versionArn': function_data['versionArn'],
        'codeContent': function_data['codeContent'],
        'origins': function_data['origins'],
        'regionMapping': function_data['regionMapping'],
        'preset': function_data['preset'],
        'createdBy': function_data['createdBy'],
        'createdAt': datetime.utcnow().isoformat() + 'Z',
        'updatedAt': datetime.utcnow().isoformat() + 'Z',
        'status': 'active'
    }
    
    try:
        table.put_item(Item=item)
        logger.info("Function record saved to DynamoDB")
    except Exception as error:
        logger.error(f"Error saving function record: {error}")
        raise error

def create_lambda_edge_function(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Main function to create Lambda@Edge function
    
    Args:
        config: Configuration containing name, origins, preset, and createdBy
        
    Returns:
        Function data dictionary
    """
    name = config['name']
    origins = config['origins']
    preset = config['preset']
    created_by = config['createdBy']
    
    function_id = f"func-{str(uuid.uuid4())[:8]}"
    function_name = f"{name}-multi-origin-func-{function_id}"
    
    try:
        # Initialize AWS clients
        lambda_client = get_lambda_client('us-east-1')  # Lambda@Edge must be in us-east-1
        dynamodb = get_dynamodb_resource()
        
        # Generate function code
        code_content = generate_function_code(origins, preset)
        
        # Create Lambda function
        lambda_result = create_lambda_function(lambda_client, function_name, code_content)
        
        # Ensure versioned ARN format
        version_arn = lambda_result['FunctionArn']
        if not version_arn.endswith(f":{lambda_result.get('Version', '1')}"):
            version_arn = f"{lambda_result['FunctionArn']}:{lambda_result.get('Version', '1')}"
        
        # Prepare function data
        function_data = {
            'functionId': function_id,
            'functionName': function_name,
            'functionArn': lambda_result['FunctionArn'],
            'versionArn': version_arn,
            'codeContent': code_content,
            'origins': origins,
            'regionMapping': REGION_MAPPING_PRESETS[preset]['mapping'],
            'preset': preset,
            'createdBy': created_by
        }
        
        # Save to DynamoDB
        save_function_record(dynamodb, function_data)
        
        return function_data
        
    except Exception as error:
        logger.error(f"Error creating Lambda@Edge function: {error}")
        raise error

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to create Lambda@Edge function
    
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
                'error': 'Request body is required'
            })
        
        # Validate required fields
        name = request_data.get('name')
        origins = request_data.get('origins')
        preset = request_data.get('preset')
        
        if not name or not origins or not preset:
            return cors_response(400, {
                'success': False,
                'error': 'Missing required fields: name, origins, preset'
            })
        
        if not origins.get('default') or not origins.get('additional') or len(origins['additional']) == 0:
            return cors_response(400, {
                'success': False,
                'error': 'Must provide default origin and at least one additional origin'
            })
        
        # Get user from JWT token
        created_by = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'system')
        
        # Create Lambda@Edge function
        function_data = create_lambda_edge_function({
            'name': name,
            'origins': origins,
            'preset': preset,
            'createdBy': created_by
        })
        
        logger.info(f"Successfully created Lambda@Edge function: {function_data['functionId']}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'functionId': function_data['functionId'],
                'functionName': function_data['functionName'],
                'functionArn': function_data['functionArn'],
                'versionArn': function_data['versionArn'],
                'preset': function_data['preset'],
                'status': 'active'
            },
            'message': f'Lambda@Edge function {name} created successfully'
        })
        
    except ValueError as validation_error:
        logger.error(f"Validation error: {validation_error}")
        return cors_response(400, {
            'success': False,
            'error': str(validation_error)
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error creating Lambda@Edge function: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error creating Lambda@Edge function: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
