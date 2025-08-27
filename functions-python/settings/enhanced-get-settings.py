import json
import boto3
import logging
import os
from botocore.exceptions import ClientError
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Enhanced get settings function with admin group validation
    
    This function provides double-check admin access validation for settings retrieval.
    """
    try:
        # Double-check admin access from the authorizer context
        request_context = event.get('requestContext', {})
        authorizer_context = request_context.get('authorizer', {})
        
        # Extract user information from authorizer context
        username = authorizer_context.get('username', 'unknown')
        groups = authorizer_context.get('groups', '').split(',') if authorizer_context.get('groups') else []
        
        # Double-check admin access
        if 'Administrators' not in groups:
            logger.warning(f"Non-admin user {username} attempted to access settings")
            return cors_response(403, {
                'error': 'Access denied. Administrator privileges required.'
            })
        
        logger.info(f"Admin user {username} accessing settings")
        
        # Initialize DynamoDB
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        
        # Parse query parameters
        query_params = event.get('queryStringParameters') or {}
        setting_key = query_params.get('key')
        
        if setting_key:
            # Get specific setting
            try:
                response = table.get_item(Key={'settingKey': setting_key})
                if 'Item' in response:
                    setting = response['Item']
                    logger.info(f"Retrieved setting: {setting_key}")
                    return cors_response(200, {
                        'setting': setting
                    })
                else:
                    return cors_response(404, {
                        'error': f'Setting not found: {setting_key}'
                    })
            except ClientError as e:
                logger.error(f"Error retrieving setting {setting_key}: {str(e)}")
                return cors_response(500, {
                    'error': 'Failed to retrieve setting'
                })
        else:
            # Get all settings
            try:
                response = table.scan()
                settings = response.get('Items', [])
                
                # Sort settings by key
                settings.sort(key=lambda x: x.get('settingKey', ''))
                
                logger.info(f"Retrieved {len(settings)} settings")
                return cors_response(200, {
                    'settings': settings,
                    'count': len(settings)
                })
            except ClientError as e:
                logger.error(f"Error retrieving settings: {str(e)}")
                return cors_response(500, {
                    'error': 'Failed to retrieve settings'
                })
        
    except Exception as e:
        logger.error(f"Unexpected error in get settings: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def cors_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a response with CORS headers
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true'
        },
        'body': json.dumps(body, ensure_ascii=False, default=str)
    }