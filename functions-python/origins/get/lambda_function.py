"""
Get S3 origin details - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to get S3 origin details
    
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
        
        # Check environment variables
        origins_table = os.environ.get('ORIGINS_TABLE')
        if not origins_table:
            logger.error('ORIGINS_TABLE environment variable is not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: ORIGINS_TABLE not configured'
            })
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(origins_table)
        
        # Get origin from DynamoDB
        response = table.get_item(
            Key={'originId': origin_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Origin with ID {origin_id} not found'
            })
        
        origin_item = response['Item']
        
        # Format response
        origin_data = {
            'id': origin_item.get('originId'),
            'name': origin_item.get('name'),
            'bucketName': origin_item.get('bucketName'),
            'region': origin_item.get('region'),
            'isWebsiteEnabled': origin_item.get('isWebsiteEnabled', False),
            'websiteConfiguration': origin_item.get('websiteConfiguration'),
            'corsConfiguration': origin_item.get('corsConfiguration'),
            'oacId': origin_item.get('oacId'),
            'distributionArns': origin_item.get('distributionArns', []),
            'createdBy': origin_item.get('createdBy'),
            'createdAt': origin_item.get('createdAt'),
            'updatedAt': origin_item.get('updatedAt')
        }
        
        logger.info(f"Retrieved origin: {origin_id}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'origin': origin_data
            }
        })
        
    except Exception as error:
        logger.error(f'Error getting origin: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error getting origin',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
