"""
Create CloudFront cache invalidation - Python implementation
"""
import os
import json
import logging
import uuid
from datetime import datetime
from typing import Dict, Any, List
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter, extract_request_data
from aws_clients import get_dynamodb_resource, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to create CloudFront cache invalidation
    
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
        # Get distribution ID from path parameters
        distribution_id = get_path_parameter(event, 'id')
        
        if not distribution_id:
            return cors_response(400, {
                'success': False,
                'message': 'Distribution ID is required'
            })
        
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'message': 'Request body is required'
            })
        
        # Validate paths
        paths = request_data.get('paths')
        if not paths or not isinstance(paths, list) or len(paths) == 0:
            return cors_response(400, {
                'success': False,
                'message': 'At least one path is required for invalidation'
            })
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        history_table = os.environ.get('HISTORY_TABLE')
        
        if not distributions_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Check if distribution exists
        response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Distribution {distribution_id} not found'
            })
        
        distribution_record = response['Item']
        cloudfront_id = distribution_record.get('cloudfrontId')
        
        if not cloudfront_id:
            return cors_response(400, {
                'success': False,
                'message': 'CloudFront ID not found in distribution record'
            })
        
        # Create invalidation
        caller_reference = request_data.get('callerReference', str(uuid.uuid4()))
        
        invalidation_params = {
            'DistributionId': cloudfront_id,
            'InvalidationBatch': {
                'CallerReference': caller_reference,
                'Paths': {
                    'Quantity': len(paths),
                    'Items': paths
                }
            }
        }
        
        logger.info(f"Creating invalidation for distribution {cloudfront_id} with paths: {paths}")
        
        result = cloudfront.create_invalidation(**invalidation_params)
        
        invalidation = result['Invalidation']
        invalidation_id = invalidation['Id']
        status = invalidation['Status']
        create_time = invalidation['CreateTime']
        
        logger.info(f"Created invalidation {invalidation_id} with status {status}")
        
        # Get user info from Cognito claims
        user = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'unknown')
        
        # Record invalidation in history table
        if history_table:
            try:
                history_tbl = dynamodb.Table(history_table)
                timestamp = datetime.utcnow().isoformat() + 'Z'
                
                history_tbl.put_item(
                    Item={
                        'distributionId': distribution_id,
                        'timestamp': timestamp,
                        'action': 'INVALIDATION',
                        'user': user,
                        'invalidationId': invalidation_id,
                        'paths': paths
                    }
                )
                logger.info(f"Recorded invalidation in history: {invalidation_id}")
                
            except Exception as history_error:
                logger.warning(f"Could not record invalidation history: {history_error}")
        
        return cors_response(201, {
            'success': True,
            'data': {
                'invalidationId': invalidation_id,
                'status': status,
                'createTime': create_time,
                'paths': paths
            },
            'message': f'Cache invalidation created successfully for {len(paths)} path(s)'
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error creating invalidation: {error_code} - {error_message}')
        
        # Handle specific CloudFront errors
        if error_code == 'NoSuchDistribution':
            return cors_response(404, {
                'success': False,
                'message': 'CloudFront distribution not found'
            })
        elif error_code == 'TooManyInvalidationsInProgress':
            return cors_response(429, {
                'success': False,
                'message': 'Too many invalidations in progress. Please wait and try again.'
            })
        elif error_code == 'InvalidArgument':
            return cors_response(400, {
                'success': False,
                'message': 'Invalid invalidation request',
                'error': error_message
            })
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to create invalidation',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error creating invalidation: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error creating invalidation',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
