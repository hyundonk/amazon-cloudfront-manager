"""
List S3 origins - Python implementation
"""
import os
import json
import base64
import logging
from typing import Dict, Any, Optional

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_query_parameter
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to list all S3 origins
    
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
        # Check environment variables
        origins_table = os.environ.get('ORIGINS_TABLE')
        if not origins_table:
            logger.error('ORIGINS_TABLE environment variable is not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: ORIGINS_TABLE not configured'
            })
        
        # Get query parameters
        limit_str = get_query_parameter(event, 'limit')
        next_token = get_query_parameter(event, 'nextToken')
        
        limit = int(limit_str) if limit_str else 50
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(origins_table)
        
        # Prepare scan parameters
        scan_kwargs = {
            'Limit': limit
        }
        
        # Handle pagination
        if next_token:
            try:
                exclusive_start_key = json.loads(base64.b64decode(next_token).decode())
                scan_kwargs['ExclusiveStartKey'] = exclusive_start_key
            except Exception as token_error:
                logger.warning(f"Invalid nextToken: {token_error}")
                # Continue without pagination
        
        # Scan DynamoDB for origins
        response = table.scan(**scan_kwargs)
        
        # Format response
        origins = []
        for item in response.get('Items', []):
            origin = {
                'id': item.get('originId'),
                'name': item.get('name'),
                'bucketName': item.get('bucketName'),
                'region': item.get('region'),
                'isWebsiteEnabled': item.get('isWebsiteEnabled', False),
                'createdAt': item.get('createdAt'),
                'updatedAt': item.get('updatedAt')
            }
            origins.append(origin)
        
        # Prepare response data
        response_data = {
            'origins': origins,
            'count': len(origins),
            'total': response.get('Count', len(origins))
        }
        
        # Generate next token if there are more results
        if 'LastEvaluatedKey' in response:
            next_token_data = base64.b64encode(
                json.dumps(response['LastEvaluatedKey']).encode()
            ).decode()
            response_data['nextToken'] = next_token_data
        
        logger.info(f"Found {len(origins)} origins")
        
        return cors_response(200, {
            'success': True,
            'data': response_data
        })
        
    except Exception as error:
        logger.error(f'Error listing origins: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error listing origins',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
