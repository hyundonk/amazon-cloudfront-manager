"""
Apply CloudFront distribution template - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter, extract_request_data
from aws_clients import get_dynamodb_resource, get_lambda_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to apply template to create CloudFront distribution
    
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
        
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'error': 'Request body is required'
            })
        
        # Validate required fields
        name = request_data.get('name')
        if not name:
            return cors_response(400, {
                'success': False,
                'error': 'Missing required field: name'
            })
        
        # Check environment variables
        templates_table = os.environ.get('TEMPLATES_TABLE')
        create_distribution_function = os.environ.get('CREATE_DISTRIBUTION_FUNCTION')
        
        if not templates_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: TEMPLATES_TABLE not configured'
            })
        
        if not create_distribution_function:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: CREATE_DISTRIBUTION_FUNCTION not configured'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        lambda_client = get_lambda_client()
        
        templates_tbl = dynamodb.Table(templates_table)
        
        # Get the template
        response = templates_tbl.get_item(
            Key={'templateId': template_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'error': 'Template not found'
            })
        
        template = response['Item']
        template_config = template.get('config', {})
        
        # Prepare the distribution configuration
        distribution_config = template_config.copy()
        distribution_config['Comment'] = name
        
        # Override any specific configuration from the request
        if request_data.get('config'):
            distribution_config.update(request_data['config'])
        
        # Prepare the payload for create distribution function
        create_payload = {
            'httpMethod': 'POST',
            'body': json.dumps({
                'name': name,
                'config': distribution_config,
                'templateId': template_id,
                'templateName': template.get('name'),
                # Pass through any additional parameters
                **{k: v for k, v in request_data.items() 
                   if k not in ['name', 'config']}
            }),
            'requestContext': event.get('requestContext', {}),
            'pathParameters': {},
            'queryStringParameters': {}
        }
        
        logger.info(f"Applying template {template_id} to create distribution: {name}")
        
        # Invoke the create distribution function
        invoke_response = lambda_client.invoke(
            FunctionName=create_distribution_function,
            InvocationType='RequestResponse',
            Payload=json.dumps(create_payload)
        )
        
        # Parse the response
        response_payload = json.loads(invoke_response['Payload'].read())
        
        # Check if the invocation was successful
        if invoke_response.get('StatusCode') != 200:
            logger.error(f"Create distribution function returned status: {invoke_response.get('StatusCode')}")
            return cors_response(500, {
                'success': False,
                'message': 'Failed to invoke create distribution function',
                'error': 'Function invocation failed'
            })
        
        # Parse the actual response from the create distribution function
        if response_payload.get('statusCode') == 200:
            # Success case
            try:
                response_body = json.loads(response_payload.get('body', '{}'))
                
                logger.info(f"Successfully applied template {template_id} to create distribution")
                
                return cors_response(201, {
                    'success': True,
                    'data': response_body.get('data', {}),
                    'message': f'Template {template.get("name", template_id)} applied successfully to create distribution {name}',
                    'templateApplied': {
                        'templateId': template_id,
                        'templateName': template.get('name'),
                        'appliedAt': response_body.get('data', {}).get('distribution', {}).get('createdAt')
                    }
                })
                
            except json.JSONDecodeError as parse_error:
                logger.error(f"Could not parse create distribution response: {parse_error}")
                return cors_response(500, {
                    'success': False,
                    'message': 'Invalid response from create distribution function'
                })
        else:
            # Error case
            try:
                error_body = json.loads(response_payload.get('body', '{}'))
                error_message = error_body.get('message', 'Unknown error from create distribution function')
                
                logger.error(f"Create distribution function failed: {error_message}")
                
                return cors_response(response_payload.get('statusCode', 500), {
                    'success': False,
                    'message': f'Failed to apply template: {error_message}',
                    'error': error_body.get('error', 'Unknown error'),
                    'templateId': template_id
                })
                
            except json.JSONDecodeError:
                return cors_response(500, {
                    'success': False,
                    'message': 'Failed to apply template - unknown error',
                    'templateId': template_id
                })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error applying template: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'AWS error applying template',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error applying template: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error applying template',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
