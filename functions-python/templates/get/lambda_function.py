"""
Get CloudFront distribution template by ID - Python implementation
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
    Lambda handler to get CloudFront distribution template by ID
    
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
        # Get template ID from path parameters
        template_id = get_path_parameter(event, 'id')
        
        if not template_id:
            return cors_response(400, {
                'success': False,
                'error': 'Missing template ID'
            })
        
        # Check environment variables
        templates_table = os.environ.get('TEMPLATES_TABLE')
        if not templates_table:
            logger.error('TEMPLATES_TABLE environment variable is not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: TEMPLATES_TABLE not configured'
            })
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(templates_table)
        
        # Get template from DynamoDB
        response = table.get_item(
            Key={'templateId': template_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'error': 'Template not found'
            })
        
        template = response['Item']
        
        # Transform the template to match the expected format in the frontend
        transformed_template = {
            'id': template.get('templateId'),  # Map templateId to id for frontend compatibility
            'name': template.get('name'),
            'category': template.get('category'),
            'description': template.get('description'),
            'features': template.get('config', {}).get('features', []),
            'createdAt': template.get('createdAt'),
            'updatedAt': template.get('updatedAt'),
            'createdBy': template.get('createdBy'),
            'config': template.get('config')
        }
        
        logger.info(f"Retrieved template: {template_id}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'template': transformed_template
            }
        })
        
    except Exception as error:
        logger.error(f'Error getting template: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
