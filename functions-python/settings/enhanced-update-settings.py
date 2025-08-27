import json
import boto3
import logging
import os
from datetime import datetime
from botocore.exceptions import ClientError
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Enhanced update settings function with admin group validation
    
    This function provides double-check admin access validation for settings updates.
    """
    try:
        # Double-check admin access from the authorizer context
        request_context = event.get('requestContext', {})
        authorizer_context = request_context.get('authorizer', {})
        
        # Extract user information from authorizer context
        username = authorizer_context.get('username', 'unknown')
        email = authorizer_context.get('email', 'unknown')
        groups = authorizer_context.get('groups', '').split(',') if authorizer_context.get('groups') else []
        
        # Double-check admin access
        if 'Administrators' not in groups:
            logger.warning(f"Non-admin user {username} attempted to update settings")
            return cors_response(403, {
                'error': 'Access denied. Administrator privileges required.'
            })
        
        logger.info(f"Admin user {username} ({email}) updating settings")
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        if not body:
            return cors_response(400, {
                'error': 'Request body is required'
            })
        
        # Initialize DynamoDB
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        
        # Validate settings data
        settings_to_update = body.get('settings', [])
        if not isinstance(settings_to_update, list):
            return cors_response(400, {
                'error': 'Settings must be provided as an array'
            })
        
        updated_settings = []
        errors = []
        
        # Process each setting
        for setting in settings_to_update:
            try:
                setting_key = setting.get('settingKey')
                setting_value = setting.get('settingValue')
                setting_description = setting.get('description', '')
                
                if not setting_key:
                    errors.append('Setting key is required')
                    continue
                
                if setting_value is None:
                    errors.append(f'Setting value is required for key: {setting_key}')
                    continue
                
                # Validate setting key format
                if not isinstance(setting_key, str) or len(setting_key.strip()) == 0:
                    errors.append(f'Invalid setting key: {setting_key}')
                    continue
                
                # Create setting item
                setting_item = {
                    'settingKey': setting_key.strip(),
                    'settingValue': setting_value,
                    'description': setting_description,
                    'updatedAt': datetime.utcnow().isoformat(),
                    'updatedBy': username
                }
                
                # Check if this is a new setting
                try:
                    existing_response = table.get_item(Key={'settingKey': setting_key})
                    if 'Item' not in existing_response:
                        setting_item['createdAt'] = datetime.utcnow().isoformat()
                        setting_item['createdBy'] = username
                except ClientError as e:
                    logger.warning(f"Could not check existing setting {setting_key}: {str(e)}")
                    setting_item['createdAt'] = datetime.utcnow().isoformat()
                    setting_item['createdBy'] = username
                
                # Update the setting
                table.put_item(Item=setting_item)
                updated_settings.append({
                    'settingKey': setting_key,
                    'settingValue': setting_value,
                    'status': 'updated'
                })
                
                logger.info(f"Updated setting: {setting_key}")
                
            except ClientError as e:
                error_msg = f"Failed to update setting {setting.get('settingKey', 'unknown')}: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)
            except Exception as e:
                error_msg = f"Unexpected error updating setting {setting.get('settingKey', 'unknown')}: {str(e)}"
                logger.error(error_msg)
                errors.append(error_msg)
        
        # Prepare response
        response_data = {
            'updatedSettings': updated_settings,
            'successCount': len(updated_settings),
            'errorCount': len(errors)
        }
        
        if errors:
            response_data['errors'] = errors
        
        # Determine response status
        if len(updated_settings) > 0 and len(errors) == 0:
            # All successful
            status_code = 200
            response_data['message'] = f'Successfully updated {len(updated_settings)} settings'
        elif len(updated_settings) > 0 and len(errors) > 0:
            # Partial success
            status_code = 207  # Multi-Status
            response_data['message'] = f'Updated {len(updated_settings)} settings with {len(errors)} errors'
        else:
            # All failed
            status_code = 400
            response_data['message'] = 'Failed to update any settings'
        
        logger.info(f"Settings update completed: {len(updated_settings)} successful, {len(errors)} errors")
        
        return cors_response(status_code, response_data)
        
    except json.JSONDecodeError:
        logger.error("Invalid JSON in request body")
        return cors_response(400, {
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error in update settings: {str(e)}")
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