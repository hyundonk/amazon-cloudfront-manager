"""
Update CloudFront distribution template - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter, extract_request_data
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def process_ssl_configuration(config: Dict[str, Any], certificate_arn: str = None, 
                            custom_domains: str = None, viewer_protocol: str = None,
                            min_tls_version: str = None) -> Dict[str, Any]:
    """
    Process SSL certificate configuration for template
    
    Args:
        config: Base configuration dictionary
        certificate_arn: ACM certificate ARN
        custom_domains: Comma-separated custom domains
        viewer_protocol: Viewer protocol policy
        min_tls_version: Minimum TLS version
        
    Returns:
        Processed configuration with SSL settings
    """
    processed_config = config.copy()
    
    if certificate_arn and custom_domains:
        # Parse custom domains
        domains = [d.strip() for d in custom_domains.split(',') if d.strip()]
        
        processed_config.update({
            'ViewerCertificate': {
                'AcmCertificateArn': certificate_arn,
                'SslSupportMethod': 'sni-only',
                'MinimumProtocolVersion': min_tls_version or 'TLSv1.2_2021',
                'CertificateSource': 'acm'
            },
            'Aliases': {
                'Quantity': len(domains),
                'Items': domains
            }
        })
        
        # Update default cache behavior with viewer protocol
        if 'DefaultCacheBehavior' in processed_config:
            processed_config['DefaultCacheBehavior']['ViewerProtocolPolicy'] = viewer_protocol or 'redirect-to-https'
    
    elif 'DefaultCacheBehavior' in processed_config:
        # Ensure default certificate configuration
        processed_config['ViewerCertificate'] = {
            'CloudFrontDefaultCertificate': True,
            'MinimumProtocolVersion': min_tls_version or 'TLSv1.2_2021'
        }
    
    return processed_config

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to update CloudFront distribution template
    
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
        config = request_data.get('config')
        
        if not name or not config:
            return cors_response(400, {
                'success': False,
                'error': 'Missing required fields: name and config'
            })
        
        # Check environment variables
        templates_table = os.environ.get('TEMPLATES_TABLE')
        if not templates_table:
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
        
        existing_template = response['Item']
        
        # Process SSL certificate configuration if provided
        processed_config = process_ssl_configuration(
            config=config,
            certificate_arn=request_data.get('certificateArn'),
            custom_domains=request_data.get('customDomains'),
            viewer_protocol=request_data.get('viewerProtocol'),
            min_tls_version=request_data.get('minTlsVersion')
        )
        
        # Prepare update expression
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Build update expression dynamically
        update_expression_parts = []
        expression_attribute_values = {}
        expression_attribute_names = {}
        
        # Always update these fields
        update_expression_parts.append('#name = :name')
        update_expression_parts.append('#config = :config')
        update_expression_parts.append('updatedAt = :updatedAt')
        
        expression_attribute_names['#name'] = 'name'
        expression_attribute_names['#config'] = 'config'
        expression_attribute_values[':name'] = name
        expression_attribute_values[':config'] = processed_config
        expression_attribute_values[':updatedAt'] = timestamp
        
        # Optional fields
        if request_data.get('description') is not None:
            update_expression_parts.append('description = :description')
            expression_attribute_values[':description'] = request_data['description']
        
        if request_data.get('category') is not None:
            update_expression_parts.append('category = :category')
            expression_attribute_values[':category'] = request_data['category']
        
        # Update template in DynamoDB
        update_expression = 'SET ' + ', '.join(update_expression_parts)
        
        table.update_item(
            Key={'templateId': template_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Updated template: {template_id}")
        
        # Get updated template for response
        updated_response = table.get_item(
            Key={'templateId': template_id}
        )
        
        updated_template = updated_response['Item']
        
        # Transform response for frontend compatibility
        response_template = {
            'id': template_id,
            'name': updated_template.get('name'),
            'description': updated_template.get('description'),
            'category': updated_template.get('category'),
            'features': processed_config.get('features', []),
            'createdAt': updated_template.get('createdAt'),
            'updatedAt': timestamp,
            'createdBy': updated_template.get('createdBy'),
            'config': processed_config
        }
        
        return cors_response(200, {
            'success': True,
            'data': {
                'template': response_template
            },
            'message': f'Template {name} updated successfully'
        })
        
    except json.JSONDecodeError as json_error:
        logger.error(f'Invalid JSON in request body: {json_error}')
        return cors_response(400, {
            'success': False,
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as error:
        logger.error(f'Error updating template: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
