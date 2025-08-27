import json
import os
import boto3
from typing import Dict, Any
from botocore.exceptions import ClientError

# Initialize AWS clients
cloudwatch_logs = boto3.client('logs')
dynamodb = boto3.resource('dynamodb')

def configure_access_logs_v2(distribution_id: str, cloudfront_id: str) -> Dict[str, Any]:
    """
    Configure CloudFront Standard v2 logging (access log v2) with CloudWatch Logs delivery
    """
    try:
        print(f'Configuring access logs v2 for distribution {distribution_id} ({cloudfront_id})')
        
        # Get CloudFront access logs v2 settings
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        settings_response = table.get_item(
            Key={'settingKey': 'cloudfront-access-logs-v2'}
        )
        
        if 'Item' not in settings_response or not settings_response['Item'].get('enabled'):
            print('CloudFront access logs v2 not enabled, skipping configuration')
            return {
                'success': True,
                'configured': False,
                'reason': 'Not enabled'
            }
        
        settings = settings_response['Item']
        bucket_name = settings['bucketName']
        output_format = settings.get('outputFormat', 'json')
        partitioning = settings.get('partitioning', {'enabled': True})
        compression = settings.get('compression', 'gzip')
        
        # Create delivery destination name
        destination_name = f'cloudfront-access-logs-{cloudfront_id}'
        delivery_source_name = f'cloudfront-{cloudfront_id}'
        
        # Step 1: Create delivery destination
        destination_result = create_delivery_destination(
            destination_name, bucket_name, output_format, partitioning, compression
        )
        
        if not destination_result['success']:
            raise Exception(f"Failed to create delivery destination: {destination_result['error']}")
        
        # Step 2: Set delivery destination policy
        policy_result = set_delivery_destination_policy(destination_name)
        if not policy_result['success']:
            raise Exception(f"Failed to set delivery destination policy: {policy_result['error']}")
        
        # Step 3: Create delivery source
        source_result = create_delivery_source(delivery_source_name, cloudfront_id)
        if not source_result['success']:
            raise Exception(f"Failed to create delivery source: {source_result['error']}")
        
        # Step 4: Create delivery
        delivery_result = create_delivery(delivery_source_name, destination_name)
        if not delivery_result['success']:
            raise Exception(f"Failed to create delivery: {delivery_result['error']}")
        
        print(f'Successfully configured access logs v2 for distribution {distribution_id}')
        
        return {
            'success': True,
            'configured': True,
            'configuration': {
                'destinationName': destination_name,
                'deliverySourceName': delivery_source_name,
                'bucketName': bucket_name,
                'outputFormat': output_format,
                'partitioning': partitioning,
                'compression': compression,
                'deliveryId': delivery_result.get('deliveryId')
            }
        }
        
    except Exception as error:
        print(f'Error configuring access logs v2: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }

def create_delivery_destination(destination_name: str, bucket_name: str, output_format: str, 
                              partitioning: Dict[str, Any], compression: str) -> Dict[str, Any]:
    """Create CloudWatch Logs delivery destination"""
    try:
        destination_config = {
            's3DeliveryConfiguration': {
                'bucketName': bucket_name,
                'prefix': 'cloudfront-access-logs/',
                'errorOutputPrefix': 'cloudfront-access-logs-errors/',
                'bufferingHints': {
                    'sizeInMBs': 5,
                    'intervalInSeconds': 300
                },
                'compressionFormat': compression.upper(),
                'encryptionConfiguration': {
                    'noEncryptionConfig': 'NoEncryption'
                }
            }
        }
        
        # Configure output format
        if output_format == 'parquet':
            destination_config['s3DeliveryConfiguration']['dataFormatConversionConfiguration'] = {
                'enabled': True,
                'outputFormatConfiguration': {
                    'serializer': {
                        'parquetSerDe': {}
                    }
                }
            }
        
        # Configure partitioning
        if partitioning.get('enabled'):
            destination_config['s3DeliveryConfiguration']['dynamicPartitioning'] = {
                'enabled': True,
                'retryOptions': {
                    'durationInSeconds': 3600
                }
            }
            
            if partitioning.get('pattern'):
                destination_config['s3DeliveryConfiguration']['prefix'] = \
                    f"cloudfront-access-logs/{partitioning['pattern']}/"
        
        response = cloudwatch_logs.put_delivery_destination(
            name=destination_name,
            deliveryDestinationConfiguration=destination_config,
            tags={
                'Project': 'CloudFront-Manager',
                'Component': 'AccessLogs',
                'Type': 'DeliveryDestination'
            }
        )
        
        print(f'Created delivery destination: {destination_name}')
        return {
            'success': True,
            'destinationArn': response.get('deliveryDestination', {}).get('arn')
        }
        
    except Exception as error:
        print(f'Error creating delivery destination: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }

def set_delivery_destination_policy(destination_name: str) -> Dict[str, Any]:
    """Set delivery destination policy"""
    try:
        account_id = os.environ.get('AWS_ACCOUNT_ID', boto3.client('sts').get_caller_identity()['Account'])
        region = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        
        policy_document = {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Sid': 'AllowCloudFrontAccessLogs',
                    'Effect': 'Allow',
                    'Principal': {
                        'Service': 'cloudfront.amazonaws.com'
                    },
                    'Action': 'logs:PutLogEvents',
                    'Resource': f'arn:aws:logs:{region}:{account_id}:destination:{destination_name}'
                }
            ]
        }
        
        cloudwatch_logs.put_delivery_destination_policy(
            destinationName=destination_name,
            accessPolicy=json.dumps(policy_document)
        )
        
        print(f'Set delivery destination policy for: {destination_name}')
        return {'success': True}
        
    except Exception as error:
        print(f'Error setting delivery destination policy: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }

def create_delivery_source(delivery_source_name: str, cloudfront_id: str) -> Dict[str, Any]:
    """Create delivery source"""
    try:
        account_id = os.environ.get('AWS_ACCOUNT_ID', boto3.client('sts').get_caller_identity()['Account'])
        
        response = cloudwatch_logs.put_delivery_source(
            name=delivery_source_name,
            resourceArn=f'arn:aws:cloudfront::{account_id}:distribution/{cloudfront_id}',
            logType='APPLICATION_LOGS',
            tags={
                'Project': 'CloudFront-Manager',
                'Component': 'AccessLogs',
                'Type': 'DeliverySource',
                'CloudFrontId': cloudfront_id
            }
        )
        
        print(f'Created delivery source: {delivery_source_name}')
        return {
            'success': True,
            'sourceArn': response.get('deliverySource', {}).get('arn')
        }
        
    except Exception as error:
        print(f'Error creating delivery source: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }

def create_delivery(delivery_source_name: str, destination_name: str) -> Dict[str, Any]:
    """Create delivery"""
    try:
        account_id = os.environ.get('AWS_ACCOUNT_ID', boto3.client('sts').get_caller_identity()['Account'])
        region = os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        
        response = cloudwatch_logs.create_delivery(
            deliverySourceName=delivery_source_name,
            deliveryDestinationArn=f'arn:aws:logs:{region}:{account_id}:destination:{destination_name}',
            tags={
                'Project': 'CloudFront-Manager',
                'Component': 'AccessLogs',
                'Type': 'Delivery'
            }
        )
        
        delivery_id = response.get('delivery', {}).get('id')
        print(f'Created delivery: {delivery_id}')
        
        return {
            'success': True,
            'deliveryId': delivery_id,
            'deliveryArn': response.get('delivery', {}).get('arn')
        }
        
    except Exception as error:
        print(f'Error creating delivery: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }
