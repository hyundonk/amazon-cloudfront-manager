"""
Enhanced Settings API - Get Settings with Admin Group Validation
Implements simplified two-tier access control: Administrators and Regular Users
"""

import json
import os
import boto3
from typing import Dict, Any
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
settings_table = dynamodb.Table(os.environ.get('SETTINGS_TABLE', 'cf-manager-settings'))

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Settings API handler with admin group validation
    """
    try:
        # Extract user context from authorizer
        user_context = event.get('requestContext', {}).get('authorizer', {})
        user_groups = user_context.get('userGroups', '').split(',') if user_context.get('userGroups') else []
        user_id = user_context.get('userId', 'unknown')
        user_email = user_context.get('userEmail', user_id)
        is_admin = user_context.get('isAdmin', 'false').lower() == 'true'
        
        logger.info(f"Settings access request from user {user_email} (admin: {is_admin})")
        
        # Double-check admin access (defense in depth)
        if not is_admin or 'Administrators' not in user_groups:
            logger.warning(f"Access denied: User {user_email} not in Administrators group")
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': False,
                    'error': 'Access denied. Administrator privileges required.',
                    'details': 'Only users in the Administrators group can access settings.'
                })
            }
        
        # Process settings request
        http_method = event.get('httpMethod', 'GET')
        path_parameters = event.get('pathParameters') or {}
        setting_key = path_parameters.get('key')
        
        if http_method == 'GET':
            return handle_get_setting(setting_key, user_email)
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
        logger.error(f"Settings API error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'details': str(e) if os.environ.get('DEBUG') == 'true' else None
            })
        }

def handle_get_setting(setting_key: str, user_email: str) -> Dict[str, Any]:
    """
    Handle GET setting request
    """
    try:
        # Log admin access
        logger.info(f"Admin user {user_email} accessing setting: {setting_key or 'all'}")
        
        if setting_key:
            # Get specific setting
            response = settings_table.get_item(Key={'settingKey': setting_key})
            
            if 'Item' not in response:
                return {
                    'statusCode': 404,
                    'headers': get_cors_headers(),
                    'body': json.dumps({
                        'success': False,
                        'error': f'Setting {setting_key} not found'
                    })
                }
            
            setting = response['Item']
            
            # Remove internal fields
            if 'createdAt' in setting:
                del setting['createdAt']
            if 'updatedAt' in setting:
                del setting['updatedAt']
            
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': True,
                    'data': {
                        'setting': setting
                    }
                })
            }
        else:
            # Get all settings
            response = settings_table.scan()
            settings = response.get('Items', [])
            
            # Remove internal fields from all settings
            for setting in settings:
                if 'createdAt' in setting:
                    del setting['createdAt']
                if 'updatedAt' in setting:
                    del setting['updatedAt']
            
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'success': True,
                    'data': {
                        'settings': settings,
                        'count': len(settings)
                    }
                })
            }
            
    except Exception as e:
        logger.error(f"Error getting setting {setting_key}: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'success': False,
                'error': 'Failed to retrieve setting',
                'details': str(e) if os.environ.get('DEBUG') == 'true' else None
            })
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

def log_admin_access(user_email: str, action: str, setting_key: str = None):
    """
    Log admin access for audit purposes
    """
    log_entry = {
        'event_type': 'admin_settings_access',
        'user_email': user_email,
        'action': action,
        'setting_key': setting_key,
        'timestamp': context.aws_request_id if 'context' in globals() else 'unknown'
    }
    
    logger.info(f"Admin access audit: {json.dumps(log_entry)}")
    
    # In production, send to dedicated audit service
    # send_to_audit_service(log_entry)
