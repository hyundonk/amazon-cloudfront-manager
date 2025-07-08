"""
List Lambda@Edge functions - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any, List

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to list all Lambda@Edge functions
    
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
        
        # Scan all Lambda@Edge functions from DynamoDB
        response = table.scan()
        
        functions = []
        for item in response.get('Items', []):
            # Calculate origins count
            origins_count = 1  # Primary origin
            additional_origins = item.get('origins', {}).get('additional', [])
            if additional_origins:
                origins_count += len(additional_origins)
            
            function_data = {
                'functionId': item.get('functionId'),
                'functionName': item.get('functionName'),
                'functionArn': item.get('functionArn'),
                'preset': item.get('preset'),
                'status': item.get('status'),
                'createdBy': item.get('createdBy'),
                'createdAt': item.get('createdAt'),
                'originsCount': origins_count
            }
            functions.append(function_data)
        
        logger.info(f"Found {len(functions)} Lambda@Edge functions")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'functions': functions,
                'count': len(functions)
            }
        })
        
    except Exception as error:
        logger.error(f'Error listing Lambda@Edge functions: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
