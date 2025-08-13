import json
import os
import boto3
import re
from datetime import datetime
from typing import Dict, Any, Tuple
from botocore.exceptions import ClientError

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')

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

def validate_setting(setting_key: str, data: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate setting data"""
    if setting_key == 'consolidated-access-logs':
        if not data.get('bucketName') or not isinstance(data['bucketName'], str):
            return False, 'bucketName is required and must be a string'
        
        # Validate S3 bucket naming conventions
        bucket_name = data['bucketName']
        if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', bucket_name):
            return False, 'bucketName must follow S3 bucket naming conventions'
        
        if len(bucket_name) < 3 or len(bucket_name) > 63:
            return False, 'bucketName must be between 3 and 63 characters long'
        
        # Validate suffixPath if provided
        if 'suffixPath' in data:
            suffix_path = data['suffixPath']
            if not isinstance(suffix_path, str) or len(suffix_path) < 1:
                return False, 'suffixPath must be a non-empty string'
            if not suffix_path.endswith('/'):
                return False, 'suffixPath must end with a forward slash'
        
        # Validate partitioning settings if provided
        if 'partitioning' in data:
            partitioning = data['partitioning']
            if not isinstance(partitioning, dict):
                return False, 'partitioning must be an object'
            if 'enabled' in partitioning and not isinstance(partitioning['enabled'], bool):
                return False, 'partitioning.enabled must be a boolean'
        
        output_format = data.get('outputFormat')
        if output_format and output_format not in ['json', 'parquet']:
            return False, 'outputFormat must be either "json" or "parquet"'
        
        compression = data.get('compression')
        if compression and compression not in ['gzip', 'none']:
            return False, 'compression must be either "gzip" or "none"'
    
    return True, ''

def ensure_access_logs_bucket(bucket_name: str) -> Dict[str, Any]:
    """Ensure S3 bucket exists for access logs"""
    try:
        # Check if bucket exists
        try:
            s3.head_bucket(Bucket=bucket_name)
            print(f'Bucket {bucket_name} already exists')
            return {
                'success': True,
                'created': False,
                'region': os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            }
        except ClientError as e:
            if e.response['Error']['Code'] != '404':
                raise e
        
        # Create bucket if it doesn't exist
        region = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        create_bucket_params = {'Bucket': bucket_name}
        
        # Add LocationConstraint for regions other than us-east-1
        if region != 'us-east-1':
            create_bucket_params['CreateBucketConfiguration'] = {
                'LocationConstraint': region
            }
        
        s3.create_bucket(**create_bucket_params)
        print(f'Created bucket {bucket_name}')
        
        # Set bucket policy for CloudWatch Logs delivery
        bucket_policy = {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Sid': 'AllowCloudWatchLogsDelivery',
                    'Effect': 'Allow',
                    'Principal': {
                        'Service': 'delivery.logs.amazonaws.com'
                    },
                    'Action': 's3:PutObject',
                    'Resource': f'arn:aws:s3:::{bucket_name}/*',
                    'Condition': {
                        'StringEquals': {
                            's3:x-amz-acl': 'bucket-owner-full-control'
                        }
                    }
                },
                {
                    'Sid': 'AllowCloudWatchLogsDeliveryGetBucketAcl',
                    'Effect': 'Allow',
                    'Principal': {
                        'Service': 'delivery.logs.amazonaws.com'
                    },
                    'Action': 's3:GetBucketAcl',
                    'Resource': f'arn:aws:s3:::{bucket_name}'
                }
            ]
        }
        
        s3.put_bucket_policy(
            Bucket=bucket_name,
            Policy=json.dumps(bucket_policy)
        )
        
        return {
            'success': True,
            'created': True,
            'region': region
        }
        
    except Exception as error:
        print(f'Error ensuring access logs bucket: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }

def lambda_handler(event, context):
    """Lambda handler for updating settings"""
    print(f'Event: {json.dumps(event)}')
    
    # Handle OPTIONS request for CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Get setting key from path parameters
        setting_key = event.get('pathParameters', {}).get('key')
        request_body = json.loads(event.get('body', '{}'))
        
        if not setting_key:
            return cors_response(400, {
                'success': False,
                'error': 'Setting key is required'
            })
        
        # Validate setting data
        is_valid, error_message = validate_setting(setting_key, request_body)
        if not is_valid:
            return cors_response(400, {
                'success': False,
                'error': error_message
            })
        
        # Get settings table
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        
        # Get existing setting
        existing_response = table.get_item(
            Key={'settingKey': setting_key}
        )
        
        now = datetime.utcnow().isoformat() + 'Z'
        setting_data = {
            'settingKey': setting_key,
            **request_body,
            'updatedAt': now,
            'createdAt': existing_response.get('Item', {}).get('createdAt', now)
        }
        
        # Special handling for consolidated-access-logs setting
        if setting_key == 'consolidated-access-logs':
            bucket_result = ensure_access_logs_bucket(setting_data['bucketName'])
            if not bucket_result['success']:
                return cors_response(500, {
                    'success': False,
                    'error': 'Failed to create or validate access logs bucket',
                    'details': bucket_result['error']
                })
            
            setting_data['bucketCreated'] = bucket_result['created']
            setting_data['bucketRegion'] = bucket_result['region']
        
        # Save setting to DynamoDB
        table.put_item(Item=setting_data)
        
        return cors_response(200, {
            'success': True,
            'data': {
                'setting': setting_data
            },
            'message': 'Setting updated successfully'
        })
        
    except Exception as error:
        print(f'Error updating setting: {str(error)}')
        return cors_response(500, {
            'success': False,
            'error': 'Failed to update setting',
            'details': str(error)
        })
