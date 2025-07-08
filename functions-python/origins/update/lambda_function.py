"""
Update S3 origin configuration - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter, extract_request_data
from aws_clients import get_dynamodb_resource, get_s3_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def update_s3_website_configuration(s3_client, bucket_name: str, is_website_enabled: bool, 
                                  website_config: Optional[Dict[str, Any]] = None) -> None:
    """
    Update S3 bucket website configuration
    
    Args:
        s3_client: S3 client
        bucket_name: S3 bucket name
        is_website_enabled: Whether to enable website hosting
        website_config: Website configuration
    """
    if is_website_enabled:
        # Enable website hosting
        if not website_config:
            website_config = {
                'IndexDocument': {'Suffix': 'index.html'},
                'ErrorDocument': {'Key': 'error.html'}
            }
        
        s3_client.put_bucket_website(
            Bucket=bucket_name,
            WebsiteConfiguration=website_config
        )
        logger.info(f"Website configuration enabled for bucket {bucket_name}")
        
        # Set bucket policy to allow public access if website is enabled
        bucket_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Sid": "PublicReadGetObject",
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": "s3:GetObject",
                    "Resource": f"arn:aws:s3:::{bucket_name}/*"
                }
            ]
        }
        
        s3_client.put_bucket_policy(
            Bucket=bucket_name,
            Policy=json.dumps(bucket_policy)
        )
        logger.info(f"Public read policy applied to bucket {bucket_name}")
        
    else:
        # Disable website hosting
        try:
            s3_client.delete_bucket_website(Bucket=bucket_name)
            logger.info(f"Website configuration disabled for bucket {bucket_name}")
        except ClientError as error:
            if error.response['Error']['Code'] != 'NoSuchWebsiteConfiguration':
                raise error

def update_s3_cors_configuration(s3_client, bucket_name: str, cors_config: Optional[Dict[str, Any]]) -> None:
    """
    Update S3 bucket CORS configuration
    
    Args:
        s3_client: S3 client
        bucket_name: S3 bucket name
        cors_config: CORS configuration
    """
    if cors_config:
        s3_client.put_bucket_cors(
            Bucket=bucket_name,
            CORSConfiguration=cors_config
        )
        logger.info(f"CORS configuration updated for bucket {bucket_name}")
    else:
        # Remove CORS configuration
        try:
            s3_client.delete_bucket_cors(Bucket=bucket_name)
            logger.info(f"CORS configuration removed from bucket {bucket_name}")
        except ClientError as error:
            if error.response['Error']['Code'] != 'NoSuchCORSConfiguration':
                raise error

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to update S3 origin configuration
    
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
        # Get origin ID from path parameters
        origin_id = get_path_parameter(event, 'id')
        
        if not origin_id:
            return cors_response(400, {
                'success': False,
                'message': 'Origin ID is required'
            })
        
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'message': 'Request body is required'
            })
        
        # Check environment variables
        origins_table = os.environ.get('ORIGINS_TABLE')
        if not origins_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: ORIGINS_TABLE not configured'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        origins_tbl = dynamodb.Table(origins_table)
        
        # Get the existing origin
        response = origins_tbl.get_item(
            Key={'originId': origin_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Origin with ID {origin_id} not found'
            })
        
        existing_origin = response['Item']
        bucket_name = existing_origin.get('bucketName')
        region = existing_origin.get('region')
        
        if not bucket_name:
            return cors_response(400, {
                'success': False,
                'message': 'Origin does not have an associated S3 bucket'
            })
        
        # Initialize region-specific S3 client
        s3_client = get_s3_client(region) if region else get_s3_client()
        
        # Update S3 bucket configuration
        try:
            # Update website configuration if specified
            if 'isWebsiteEnabled' in request_data:
                is_website_enabled = request_data['isWebsiteEnabled']
                website_config = request_data.get('websiteConfiguration')
                
                update_s3_website_configuration(
                    s3_client, bucket_name, is_website_enabled, website_config
                )
            
            # Update CORS configuration if specified
            if 'corsConfiguration' in request_data:
                cors_config = request_data['corsConfiguration']
                update_s3_cors_configuration(s3_client, bucket_name, cors_config)
            
        except ClientError as s3_error:
            error_code = s3_error.response.get('Error', {}).get('Code')
            error_message = s3_error.response.get('Error', {}).get('Message', str(s3_error))
            
            logger.error(f"S3 error updating bucket {bucket_name}: {error_code} - {error_message}")
            
            return cors_response(500, {
                'success': False,
                'message': f'Failed to update S3 bucket configuration: {error_message}',
                'details': {
                    'errorCode': error_code,
                    'bucketName': bucket_name
                }
            })
        
        # Update DynamoDB record
        update_expression_parts = []
        expression_attribute_values = {}
        expression_attribute_names = {}
        
        # Always update the updatedAt timestamp
        update_expression_parts.append('updatedAt = :updatedAt')
        expression_attribute_values[':updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # Update fields that were provided in the request
        updatable_fields = ['name', 'isWebsiteEnabled', 'websiteConfiguration', 'corsConfiguration']
        
        for field in updatable_fields:
            if field in request_data:
                if field == 'name':
                    # Name is a reserved word in DynamoDB
                    update_expression_parts.append('#name = :name')
                    expression_attribute_names['#name'] = 'name'
                    expression_attribute_values[':name'] = request_data[field]
                else:
                    update_expression_parts.append(f'{field} = :{field}')
                    expression_attribute_values[f':{field}'] = request_data[field]
        
        if len(update_expression_parts) > 1:  # More than just updatedAt
            update_expression = 'SET ' + ', '.join(update_expression_parts)
            
            update_kwargs = {
                'Key': {'originId': origin_id},
                'UpdateExpression': update_expression,
                'ExpressionAttributeValues': expression_attribute_values
            }
            
            if expression_attribute_names:
                update_kwargs['ExpressionAttributeNames'] = expression_attribute_names
            
            origins_tbl.update_item(**update_kwargs)
            
            logger.info(f"Updated origin record: {origin_id}")
        
        # Get updated origin for response
        updated_response = origins_tbl.get_item(
            Key={'originId': origin_id}
        )
        
        updated_origin = updated_response['Item']
        
        # Format response
        origin_data = {
            'id': updated_origin.get('originId'),
            'name': updated_origin.get('name'),
            'bucketName': updated_origin.get('bucketName'),
            'region': updated_origin.get('region'),
            'isWebsiteEnabled': updated_origin.get('isWebsiteEnabled', False),
            'websiteConfiguration': updated_origin.get('websiteConfiguration'),
            'corsConfiguration': updated_origin.get('corsConfiguration'),
            'oacId': updated_origin.get('oacId'),
            'distributionArns': updated_origin.get('distributionArns', []),
            'createdBy': updated_origin.get('createdBy'),
            'createdAt': updated_origin.get('createdAt'),
            'updatedAt': updated_origin.get('updatedAt')
        }
        
        return cors_response(200, {
            'success': True,
            'data': {
                'origin': origin_data
            },
            'message': f'Origin {updated_origin.get("name", origin_id)} updated successfully'
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error updating origin: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to update origin',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error updating origin: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error updating origin',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
