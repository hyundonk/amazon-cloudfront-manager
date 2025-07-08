"""
List CloudFront distribution templates - Python implementation
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
    Lambda handler to list all CloudFront distribution templates
    
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
        
        # Scan all templates from DynamoDB
        response = table.scan()
        
        templates = response.get('Items', [])
        
        # Transform the templates to match the expected format in the frontend
        transformed_templates = []
        for template in templates:
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
            transformed_templates.append(transformed_template)
        
        logger.info(f"Found {len(transformed_templates)} templates")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'templates': transformed_templates
            }
        })
        
    except Exception as error:
        logger.error(f'Error listing templates: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
