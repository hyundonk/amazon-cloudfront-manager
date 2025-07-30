"""
Enhanced Settings API - Update Settings with Admin Group Validation
Implements simplified two-tier access control: Administrators and Regular Users
"""

import json
import os
import boto3
from typing import Dict, Any
from datetime import datetime
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
settings_table = dynamodb.Table(os.environ.get('SETTINGS_TABLE', 'cf-manager-settings'))

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Settings update API handler with admin group validation
    """
    try:
        # Extract user context from authorizer
        user_context = event.get('requestContext', {}).get('authorizer', {})
        user_groups = user_context.get('userGroups', '').split(',') if user_context.get('userGroups') else []
        user_id = user_context.get('userId', 'unknown')
        user_email = user_context.get('userEmail', user_id)
        is_admin = user_context.get('isAdmin', 'false').lower() == 'true'
        
        logger.info(f"Settings update request from user {user_email} (admin: {is_admin})")
        
        # Double-check admin access (defense in depth)
        if not is_admin or 'Administrators' not in user_groups:
            logger.warning(f"Access denied: User {user_email} not in Administrators group")
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Access denied. Administrator privileges required.',
                    'details': 'Only users in the Administrators group can modify settings.'
                })
            }
        
        # Process settings update request
        http_method = event.get('httpMethod', 'PUT')
        path_parameters = event.get('pathParameters') or {}
        setting_key = path_parameters.get('key')
        
        if not setting_key:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Setting key is required'
                })
            }
        
        if http_method == 'PUT':
            return handle_update_setting(setting_key, event.get('body'), user_email)
        else:
            return {
                'statusCode': 405,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Method not allowed'
                })
            }
            
    except Exception as e:
        logger.error(f"Settings update API error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'details': str(e) if os.environ.get('DEBUG') == 'true' else None
            })
        }

def handle_update_setting(setting_key: str, body: str, user_email: str) -> Dict[str, Any]:
    """
    Handle PUT setting request
    """
    try:
        # Log admin modification
        logger.info(f"Admin user {user_email} updating setting: {setting_key}")
        
        if not body:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Request body is required'
                })
            }
        
        # Parse request body
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError as e:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Invalid JSON in request body',
                    'details': str(e)
                })
            }
        
        # Validate setting key format
        if not validate_setting_key(setting_key):
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Invalid setting key format'
                })
            }
        
        # Get current setting (if exists)
        current_setting = None
        try:
            response = settings_table.get_item(Key={'settingKey': setting_key})
            current_setting = response.get('Item')
        except Exception as e:
            logger.warning(f"Could not retrieve current setting {setting_key}: {str(e)}")
        
        # Prepare setting data
        now = datetime.utcnow().isoformat()
        setting_data = {
            'settingKey': setting_key,
            'updatedAt': now,
            'updatedBy': user_email
        }
        
        # Add createdAt if this is a new setting
        if not current_setting:
            setting_data['createdAt'] = now
            setting_data['createdBy'] = user_email
        
        # Merge with request data (excluding system fields)
        system_fields = {'settingKey', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'}
        for key, value in request_data.items():
            if key not in system_fields:
                setting_data[key] = value
        
        # Validate setting data based on setting type
        validation_result = validate_setting_data(setting_key, setting_data)
        if not validation_result['valid']:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Invalid setting data',
                    'details': validation_result['errors']
                })
            }
        
        # Update setting in DynamoDB
        settings_table.put_item(Item=setting_data)
        
        # Log successful update
        log_admin_setting_change(user_email, 'update', setting_key, current_setting, setting_data)
        
        # Remove internal fields from response
        response_data = dict(setting_data)
        for field in ['createdAt', 'createdBy', 'updatedAt', 'updatedBy']:
            response_data.pop(field, None)
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': True,
                'data': {
                    'setting': response_data
                },
                'message': f'Setting {setting_key} updated successfully'
            })
        }
        
    except Exception as e:
        logger.error(f"Error updating setting {setting_key}: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': False,
                'error': 'Failed to update setting',
                'details': str(e) if os.environ.get('DEBUG') == 'true' else None
            })
        }

def validate_setting_key(setting_key: str) -> bool:
    """
    Validate setting key format
    """
    if not setting_key or not isinstance(setting_key, str):
        return False
    
    # Allow alphanumeric, hyphens, and underscores
    import re
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', setting_key))

def validate_setting_data(setting_key: str, setting_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate setting data based on setting type
    """
    errors = []
    
    # Specific validation for known settings
    if setting_key == 'consolidated-access-logs':
        if 'enabled' in setting_data and not isinstance(setting_data['enabled'], bool):
            errors.append('enabled must be a boolean')
        
        if 'bucketName' in setting_data:
            bucket_name = setting_data['bucketName']
            if not isinstance(bucket_name, str) or len(bucket_name) < 3:
                errors.append('bucketName must be a string with at least 3 characters')
        
        if 'bucketRegion' in setting_data:
            region = setting_data['bucketRegion']
            if not isinstance(region, str) or not region.startswith(('us-', 'eu-', 'ap-', 'ca-', 'sa-')):
                errors.append('bucketRegion must be a valid AWS region')
        
        if 'outputFormat' in setting_data:
            format_val = setting_data['outputFormat']
            if format_val not in ['json', 'w3c', 'raw', 'plain', 'parquet']:
                errors.append('outputFormat must be one of: json, w3c, raw, plain, parquet')
    
    return {
        'valid': len(errors) == 0,
        'errors': errors
    }

def get_cors_headers() -> Dict[str, str]:
    """
    Get CORS headers for API responses
    """
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true'
    }

def log_admin_setting_change(user_email: str, action: str, setting_key: str, old_value: Dict = None, new_value: Dict = None):
    """
    Log admin setting changes for audit purposes
    """
    log_entry = {
        'event_type': 'admin_setting_change',
        'user_email': user_email,
        'action': action,
        'setting_key': setting_key,
        'old_value': old_value,
        'new_value': new_value,
        'timestamp': datetime.utcnow().isoformat()
    }
    
    logger.info(f"Admin setting change audit: {json.dumps(log_entry, default=str)}")
    
    # In production, send to dedicated audit service
    # send_to_audit_service(log_entry)
