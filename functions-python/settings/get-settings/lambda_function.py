import json
import os
import boto3
from datetime import datetime
from typing import Dict, Any, Optional

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# CORS headers
CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
}

def cors_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Generate CORS response"""
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body)
    }

def handle_cors_preflight() -> Dict[str, Any]:
    """Handle OPTIONS request for CORS preflight"""
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': ''
    }

def get_default_setting(setting_key: str) -> Optional[Dict[str, Any]]:
    """Get default setting values"""
    account_id = os.environ.get('AWS_ACCOUNT_ID', '123456789012')
    import random
    import string
    random_string = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    
    if setting_key == 'consolidated-access-logs':
        return {
            'settingKey': 'consolidated-access-logs',
            'bucketName': f'consolidated-access-logs-{account_id}-{random_string}',
            'enabled': False,
            'outputFormat': 'json',
            'partitioning': {
                'enabled': True,
                'pattern': 'year={year}/month={month}/day={day}/hour={hour}'
            },
            'compression': 'gzip',
            'createdAt': datetime.utcnow().isoformat() + 'Z',
            'updatedAt': datetime.utcnow().isoformat() + 'Z'
        }
    return None

def lambda_handler(event, context):
    """Lambda handler for getting settings"""
    print(f'Event: {json.dumps(event)}')
    
    # Handle OPTIONS request for CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Get setting key from path parameters
        setting_key = event.get('pathParameters', {}).get('key')
        
        if not setting_key:
            return cors_response(400, {
                'success': False,
                'error': 'Setting key is required'
            })
        
        # Get settings table
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        
        # Get setting from DynamoDB
        response = table.get_item(
            Key={'settingKey': setting_key}
        )
        
        if 'Item' not in response:
            # Return default values for known settings
            default_setting = get_default_setting(setting_key)
            if default_setting:
                return cors_response(200, {
                    'success': True,
                    'data': {
                        'setting': default_setting
                    }
                })
            
            return cors_response(404, {
                'success': False,
                'error': 'Setting not found'
            })
        
        return cors_response(200, {
            'success': True,
            'data': {
                'setting': response['Item']
            }
        })
        
    except Exception as error:
        print(f'Error getting setting: {str(error)}')
        return cors_response(500, {
            'success': False,
            'error': 'Failed to get setting',
            'details': str(error)
        })
