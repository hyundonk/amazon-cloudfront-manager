"""
Delete S3 origin and associated resources - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any, List
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter
from aws_clients import get_dynamodb_resource, get_s3_client, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def empty_s3_bucket(s3_client, bucket_name: str) -> None:
    """
    Empty all objects from an S3 bucket
    
    Args:
        s3_client: S3 client
        bucket_name: Name of the S3 bucket to empty
    """
    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name)
        
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    s3_client.delete_object(Bucket=bucket_name, Key=obj['Key'])
                    logger.info(f"Deleted object {obj['Key']} from bucket {bucket_name}")
        
        logger.info(f"Successfully emptied bucket {bucket_name}")
        
    except ClientError as error:
        if error.response['Error']['Code'] == 'NoSuchBucket':
            logger.warning(f"Bucket {bucket_name} does not exist")
        else:
            raise error

def check_origin_usage(dynamodb, distributions_table: str, origin_id: str) -> List[str]:
    """
    Check if origin is being used by any distributions
    
    Args:
        dynamodb: DynamoDB resource
        distributions_table: Distributions table name
        origin_id: Origin ID to check
        
    Returns:
        List of distribution IDs using this origin
    """
    try:
        if not distributions_table:
            return []
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Scan for distributions that might be using this origin
        response = distributions_tbl.scan()
        using_distributions = []
        
        for item in response.get('Items', []):
            # Check if this distribution uses the origin
            config = item.get('config', {})
            origins = config.get('Origins', {}).get('Items', [])
            
            for origin in origins:
                # Check if origin ID matches or if it's referenced in the configuration
                if (origin.get('Id') == origin_id or 
                    origin_id in str(origin)):
                    using_distributions.append(item.get('distributionId'))
                    break
        
        return using_distributions
        
    except Exception as error:
        logger.warning(f"Could not check origin usage: {error}")
        return []

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to delete S3 origin and associated resources
    
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
        # Get origin ID from path parameters
        origin_id = get_path_parameter(event, 'id')
        
        if not origin_id:
            return cors_response(400, {
                'success': False,
                'message': 'Origin ID is required'
            })
        
        # Check environment variables
        origins_table = os.environ.get('ORIGINS_TABLE')
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        
        if not origins_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: ORIGINS_TABLE not configured'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        s3_client = get_s3_client()
        cloudfront_client = get_cloudfront_client()
        
        origins_tbl = dynamodb.Table(origins_table)
        
        # Get origin record from DynamoDB
        response = origins_tbl.get_item(
            Key={'originId': origin_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Origin with ID {origin_id} not found'
            })
        
        origin_record = response['Item']
        bucket_name = origin_record.get('bucketName')
        region = origin_record.get('region')
        oac_id = origin_record.get('oacId')
        origin_name = origin_record.get('name', origin_id)
        
        # Check if origin is being used by any distributions
        using_distributions = check_origin_usage(dynamodb, distributions_table, origin_id)
        
        if using_distributions:
            return cors_response(409, {
                'success': False,
                'message': f'Cannot delete origin {origin_name}. It is being used by {len(using_distributions)} distribution(s)',
                'details': {
                    'usingDistributions': using_distributions
                }
            })
        
        # Initialize region-specific S3 client
        if region:
            s3_client = get_s3_client(region)
        
        cleanup_results = {
            'bucket_emptied': False,
            'bucket_deleted': False,
            'oac_deleted': False,
            'record_deleted': False
        }
        
        # Clean up S3 bucket if it exists
        if bucket_name:
            try:
                logger.info(f"Emptying S3 bucket: {bucket_name}")
                empty_s3_bucket(s3_client, bucket_name)
                cleanup_results['bucket_emptied'] = True
                
                logger.info(f"Deleting S3 bucket: {bucket_name}")
                s3_client.delete_bucket(Bucket=bucket_name)
                cleanup_results['bucket_deleted'] = True
                
                logger.info(f"Successfully deleted S3 bucket: {bucket_name}")
                
            except ClientError as s3_error:
                error_code = s3_error.response.get('Error', {}).get('Code')
                
                if error_code == 'NoSuchBucket':
                    logger.warning(f"S3 bucket {bucket_name} does not exist")
                    cleanup_results['bucket_deleted'] = True  # Consider it deleted
                elif error_code == 'BucketNotEmpty':
                    logger.error(f"S3 bucket {bucket_name} is not empty after cleanup attempt")
                    return cors_response(409, {
                        'success': False,
                        'message': f'Cannot delete S3 bucket {bucket_name} - bucket is not empty'
                    })
                else:
                    logger.error(f"Error deleting S3 bucket {bucket_name}: {s3_error}")
                    return cors_response(500, {
                        'success': False,
                        'message': f'Failed to delete S3 bucket {bucket_name}',
                        'error': str(s3_error)
                    })
        
        # Clean up Origin Access Control (OAC) if it exists
        if oac_id:
            try:
                logger.info(f"Deleting Origin Access Control: {oac_id}")
                cloudfront_client.delete_origin_access_control(Id=oac_id)
                cleanup_results['oac_deleted'] = True
                logger.info(f"Successfully deleted OAC: {oac_id}")
                
            except ClientError as oac_error:
                error_code = oac_error.response.get('Error', {}).get('Code')
                
                if error_code == 'NoSuchOriginAccessControl':
                    logger.warning(f"OAC {oac_id} does not exist")
                    cleanup_results['oac_deleted'] = True  # Consider it deleted
                elif error_code == 'OriginAccessControlInUse':
                    logger.warning(f"OAC {oac_id} is still in use by other distributions")
                    # Don't fail the deletion, just log the warning
                    cleanup_results['oac_deleted'] = False
                else:
                    logger.error(f"Error deleting OAC {oac_id}: {oac_error}")
                    # Don't fail the entire operation for OAC deletion issues
                    cleanup_results['oac_deleted'] = False
        
        # Delete origin record from DynamoDB
        try:
            origins_tbl.delete_item(
                Key={'originId': origin_id}
            )
            cleanup_results['record_deleted'] = True
            logger.info(f"Deleted origin record: {origin_id}")
            
        except Exception as db_error:
            logger.error(f"Error deleting origin record: {db_error}")
            return cors_response(500, {
                'success': False,
                'message': 'Failed to delete origin record from database',
                'error': str(db_error)
            })
        
        # Determine overall success
        critical_operations = ['record_deleted']
        if bucket_name:
            critical_operations.extend(['bucket_emptied', 'bucket_deleted'])
        
        success = all(cleanup_results.get(op, False) for op in critical_operations)
        
        if success:
            return cors_response(200, {
                'success': True,
                'message': f'Origin {origin_name} and associated resources deleted successfully',
                'data': {
                    'originId': origin_id,
                    'originName': origin_name,
                    'cleanupResults': cleanup_results
                }
            })
        else:
            return cors_response(207, {  # 207 Multi-Status
                'success': False,
                'message': f'Origin {origin_name} partially deleted - some cleanup operations failed',
                'data': {
                    'originId': origin_id,
                    'originName': origin_name,
                    'cleanupResults': cleanup_results
                }
            })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error deleting origin: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to delete origin',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error deleting origin: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error deleting origin',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
