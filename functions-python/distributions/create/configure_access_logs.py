import json
import os
import boto3
from typing import Dict, Any
from botocore.exceptions import ClientError

# Initialize AWS clients
cloudwatch_logs = boto3.client('logs', region_name='us-east-1')  # CloudFront resources use us-east-1
dynamodb = boto3.resource('dynamodb')

def configure_access_logs_v2(distribution_id: str, cloudfront_id: str) -> Dict[str, Any]:
    """
    Configure CloudFront Standard v2 logging (access log v2) with CloudWatch Logs delivery
    """
    try:
        print(f'Configuring access logs v2 for distribution {distribution_id} ({cloudfront_id})')
        
        # Get consolidated access logs settings
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        settings_response = table.get_item(
            Key={'settingKey': 'consolidated-access-logs'}
        )
        
        if 'Item' not in settings_response or not settings_response['Item'].get('enabled'):
            print('Consolidated access logs not enabled, skipping configuration')
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
        
        print(f'Successfully configured access logs v2 for distribution {cloudfront_id}')
        
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
        # Construct S3 bucket ARN with path for CloudFront distribution
        # Following the successful example pattern: bucket/path/distribution-id
        bucket_arn = f"arn:aws:s3:::{bucket_name}/cloudfront-logs"
        
        # Create delivery destination configuration - only destinationResourceArn is supported
        delivery_destination_config = {
            'destinationResourceArn': bucket_arn
        }
        
        # Prepare parameters for put_delivery_destination
        params = {
            'name': destination_name,
            'deliveryDestinationConfiguration': delivery_destination_config
        }
        
        # Add output format as top-level parameter if specified (must be lowercase)
        if output_format:
            params['outputFormat'] = output_format.lower()  # Fixed: Use lowercase instead of upper()
        
        response = cloudwatch_logs.put_delivery_destination(**params)
        
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
        
        # Create policy document for delivery destination
        policy_document = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {
                        "AWS": f"arn:aws:iam::{account_id}:root"
                    },
                    "Action": "logs:CreateDelivery",
                    "Resource": f"arn:aws:logs:us-east-1:{account_id}:delivery-destination:{destination_name}"
                }
            ]
        }
        
        response = cloudwatch_logs.put_delivery_destination_policy(
            deliveryDestinationName=destination_name,
            deliveryDestinationPolicy=json.dumps(policy_document)
        )
        
        print(f'Set delivery destination policy for: {destination_name}')
        return {
            'success': True,
            'policy': policy_document
        }
        
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
        
        # Use the correct parameters based on the successful example
        response = cloudwatch_logs.put_delivery_source(
            name=delivery_source_name,
            resourceArn=f'arn:aws:cloudfront::{account_id}:distribution/{cloudfront_id}',
            logType='ACCESS_LOGS'  # Fixed: Changed from APPLICATION_LOGS to ACCESS_LOGS
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
    """Create delivery with Hive-compatible partitioning"""
    try:
        account_id = os.environ.get('AWS_ACCOUNT_ID', boto3.client('sts').get_caller_identity()['Account'])
        
        # Get partitioning settings from DynamoDB
        table = dynamodb.Table(os.environ['SETTINGS_TABLE'])
        settings_response = table.get_item(
            Key={'settingKey': 'consolidated-access-logs'}
        )
        
        partitioning = settings_response.get('Item', {}).get('partitioning', {})
        partitioning_enabled = partitioning.get('enabled', True)  # Default to enabled
        suffix_path = settings_response.get('Item', {}).get('suffixPath', 'cloudfront-logs/')  # Fixed default path
        
        # Prepare delivery parameters
        delivery_params = {
            'deliverySourceName': delivery_source_name,
            'deliveryDestinationArn': f'arn:aws:logs:us-east-1:{account_id}:delivery-destination:{destination_name}'
        }
        
        # Add S3 delivery configuration with proper suffixPath and Hive partitioning
        delivery_params['s3DeliveryConfiguration'] = {
            'suffixPath': suffix_path,  # Simple directory path (e.g., "cloudfront-logs/")
            'enableHiveCompatiblePath': partitioning_enabled  # AWS handles automatic partitioning
        }
        
        if partitioning_enabled:
            print(f'Configured Hive-compatible partitioning enabled with suffixPath: {suffix_path}')
        else:
            print(f'Configured simple path structure with suffixPath: {suffix_path}')
        
        response = cloudwatch_logs.create_delivery(**delivery_params)
        
        print(f'Created delivery: {delivery_source_name} -> {destination_name}')
        return {
            'success': True,
            'deliveryId': response.get('delivery', {}).get('id')
        }
        
    except Exception as error:
        print(f'Error creating delivery: {str(error)}')
        return {
            'success': False,
            'error': str(error)
        }
