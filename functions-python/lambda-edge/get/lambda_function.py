"""
Get Lambda@Edge function details - Python implementation
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
    Lambda handler to get Lambda@Edge function details
    
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
        # Get function ID from path parameters
        function_id = get_path_parameter(event, 'id')
        
        if not function_id:
            return cors_response(400, {
                'success': False,
                'error': 'Function ID is required'
            })
        
        # Check environment variables
        lambda_edge_table = os.environ.get('LAMBDA_EDGE_FUNCTIONS_TABLE')
        if not lambda_edge_table:
            logger.error('LAMBDA_EDGE_FUNCTIONS_TABLE environment variable is not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: LAMBDA_EDGE_FUNCTIONS_TABLE not configured'
            })
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(lambda_edge_table)
        
        # Get Lambda@Edge function from DynamoDB
        response = table.get_item(
            Key={'functionId': function_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'error': 'Lambda@Edge function not found'
            })
        
        function_item = response['Item']
        
        logger.info(f"Retrieved Lambda@Edge function: {function_id}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'function': function_item
            }
        })
        
    except Exception as error:
        logger.error(f'Error getting Lambda@Edge function: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
