"""
Create S3 origin with OAC - Python implementation
"""
import os
import json
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, extract_request_data
from aws_clients import get_dynamodb_resource, get_s3_client, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def create_origin_access_control(cloudfront_client, bucket_name: str) -> str:
    """
    Create Origin Access Control for S3 bucket
    
    Args:
        cloudfront_client: CloudFront client
        bucket_name: S3 bucket name
        
    Returns:
        OAC ID
    """
    oac_config = {
        'Name': f"OAC-{bucket_name}-{int(datetime.utcnow().timestamp())}",
        'Description': f"Origin Access Control for S3 bucket {bucket_name}",
        'OriginAccessControlOriginType': 's3',
        'SigningBehavior': 'always',
        'SigningProtocol': 'sigv4'
    }
    
    response = cloudfront_client.create_origin_access_control(
        OriginAccessControlConfig=oac_config
    )
    
    return response['OriginAccessControl']['Id']

def configure_s3_bucket(s3_client, bucket_name: str, region: str, 
                       is_website_enabled: bool = False,
                       website_config: Dict[str, Any] = None,
                       cors_config: Dict[str, Any] = None) -> None:
    """
    Configure S3 bucket with website hosting and CORS if needed
    
    Args:
        s3_client: S3 client
        bucket_name: S3 bucket name
        region: AWS region
        is_website_enabled: Whether to enable website hosting
        website_config: Website configuration
        cors_config: CORS configuration
    """
    # Configure website hosting if enabled
    if is_website_enabled:
        if not website_config:
            website_config = {
                'IndexDocument': {'Suffix': 'index.html'},
                'ErrorDocument': {'Key': 'error.html'}
            }
        
        s3_client.put_bucket_website(
            Bucket=bucket_name,
            WebsiteConfiguration=website_config
        )
        logger.info(f"Website hosting enabled for bucket {bucket_name}")
    
    # Configure CORS if provided
    if cors_config:
        s3_client.put_bucket_cors(
            Bucket=bucket_name,
            CORSConfiguration=cors_config
        )
        logger.info(f"CORS configuration applied to bucket {bucket_name}")
    elif is_website_enabled:
        # Default CORS configuration for website hosting
        default_cors = {
            'CORSRules': [
                {
                    'AllowedHeaders': ['*'],
                    'AllowedMethods': ['GET', 'HEAD'],
                    'AllowedOrigins': ['*'],
                    'ExposeHeaders': ['ETag'],
                    'MaxAgeSeconds': 3000
                }
            ]
        }
        
        s3_client.put_bucket_cors(
            Bucket=bucket_name,
            CORSConfiguration=default_cors
        )
        logger.info(f"Default CORS configuration applied to bucket {bucket_name}")

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to create S3 origin with OAC
    
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
        bucket_name = request_data.get('bucketName')
        
        if not name:
            return cors_response(400, {
                'success': False,
                'message': 'Origin name is required'
            })
        
        if not bucket_name:
            return cors_response(400, {
                'success': False,
                'message': 'Bucket name is required'
            })
        
        # Check environment variables
        origins_table = os.environ.get('ORIGINS_TABLE')
        if not origins_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: ORIGINS_TABLE not configured'
            })
        
        # Generate unique origin ID
        origin_id = f"origin-{str(uuid.uuid4())[:8]}"
        
        # Get user info from Cognito claims
        user = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'unknown')
        
        # Get region and other configuration
        region = request_data.get('region', os.environ.get('AWS_REGION', 'us-east-1'))
        is_website_enabled = request_data.get('isWebsiteEnabled', False)
        website_config = request_data.get('websiteConfiguration')
        cors_config = request_data.get('corsConfiguration')
        
        # Initialize AWS clients
        s3_client = get_s3_client(region)
        cloudfront_client = get_cloudfront_client()
        dynamodb = get_dynamodb_resource()
        
        origins_tbl = dynamodb.Table(origins_table)
        
        oac_id = None
        
        try:
            # Create S3 bucket
            create_bucket_params = {
                'Bucket': bucket_name
            }
            
            # Add LocationConstraint for regions other than us-east-1
            if region != 'us-east-1':
                create_bucket_params['CreateBucketConfiguration'] = {
                    'LocationConstraint': region
                }
            
            s3_client.create_bucket(**create_bucket_params)
            logger.info(f"Bucket {bucket_name} created successfully")
            
            # Configure S3 bucket
            configure_s3_bucket(
                s3_client=s3_client,
                bucket_name=bucket_name,
                region=region,
                is_website_enabled=is_website_enabled,
                website_config=website_config,
                cors_config=cors_config
            )
            
            # Create Origin Access Control (OAC)
            oac_id = create_origin_access_control(cloudfront_client, bucket_name)
            logger.info(f"Created OAC: {oac_id}")
            
            # Create initial bucket policy for OAC (will be updated when distributions are created)
            initial_policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Sid": "AllowCloudFrontServicePrincipal",
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "cloudfront.amazonaws.com"
                        },
                        "Action": "s3:GetObject",
                        "Resource": f"arn:aws:s3:::{bucket_name}/*",
                        "Condition": {
                            "StringEquals": {
                                "AWS:SourceArn": []  # Will be populated when distributions are created
                            }
                        }
                    }
                ]
            }
            
            # Add public read policy if website hosting is enabled
            if is_website_enabled:
                initial_policy["Statement"].append({
                    "Sid": "PublicReadGetObject",
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": "s3:GetObject",
                    "Resource": f"arn:aws:s3:::{bucket_name}/*"
                })
            
            s3_client.put_bucket_policy(
                Bucket=bucket_name,
                Policy=json.dumps(initial_policy)
            )
            logger.info(f"Initial bucket policy applied to {bucket_name}")
            
            # Create origin record in DynamoDB
            current_time = datetime.utcnow().isoformat() + 'Z'
            
            origin_record = {
                'originId': origin_id,
                'name': name,
                'bucketName': bucket_name,
                'region': region,
                'isWebsiteEnabled': is_website_enabled,
                'websiteConfiguration': website_config,
                'corsConfiguration': cors_config,
                'oacId': oac_id,
                'distributionArns': [],  # Track which distributions use this origin
                'createdAt': current_time,
                'updatedAt': current_time,
                'createdBy': user
            }
            
            origins_tbl.put_item(Item=origin_record)
            logger.info(f"Origin record created: {origin_id}")
            
            # Format response
            response_origin = {
                'id': origin_id,
                'name': name,
                'bucketName': bucket_name,
                'region': region,
                'isWebsiteEnabled': is_website_enabled,
                'oacId': oac_id,
                'createdAt': current_time,
                'createdBy': user
            }
            
            return cors_response(201, {
                'success': True,
                'data': {
                    'origin': response_origin
                },
                'message': f'Origin {name} created successfully with S3 bucket {bucket_name}'
            })
            
        except ClientError as s3_error:
            error_code = s3_error.response.get('Error', {}).get('Code')
            
            if error_code == 'BucketAlreadyExists':
                return cors_response(409, {
                    'success': False,
                    'message': f'Bucket {bucket_name} already exists'
                })
            elif error_code == 'BucketAlreadyOwnedByYou':
                return cors_response(409, {
                    'success': False,
                    'message': f'Bucket {bucket_name} already owned by you'
                })
            else:
                # Clean up OAC if it was created
                if oac_id:
                    try:
                        cloudfront_client.delete_origin_access_control(Id=oac_id)
                        logger.info(f"Cleaned up OAC: {oac_id}")
                    except Exception as cleanup_error:
                        logger.warning(f"Could not clean up OAC {oac_id}: {cleanup_error}")
                
                raise s3_error
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error creating origin: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to create origin',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error creating origin: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error creating origin',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
