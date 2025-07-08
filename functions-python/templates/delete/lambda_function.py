"""
Delete CloudFront distribution template - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any
from botocore.exceptions import ClientError

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
    Lambda handler to delete CloudFront distribution template
    
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
        
        # Check if template exists
        response = table.get_item(
            Key={'templateId': template_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'error': 'Template not found'
            })
        
        template = response['Item']
        template_name = template.get('name', template_id)
        
        # Delete template from DynamoDB
        table.delete_item(
            Key={'templateId': template_id}
        )
        
        logger.info(f"Deleted template: {template_id} ({template_name})")
        
        return cors_response(200, {
            'success': True,
            'message': f'Template {template_name} deleted successfully',
            'data': {
                'templateId': template_id,
                'name': template_name
            }
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error deleting template: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error deleting template: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
