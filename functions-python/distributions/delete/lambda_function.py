"""
Delete CloudFront distribution - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter
from aws_clients import get_dynamodb_resource, get_cloudfront_client, get_s3_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def cleanup_multi_origin_resources(distribution_record: Dict[str, Any]) -> None:
    """
    Clean up multi-origin distribution resources (Lambda@Edge and OAI)
    
    Args:
        distribution_record: Distribution record from DynamoDB
    """
    try:
        # Check if this is a multi-origin distribution
        if not distribution_record.get('isMultiOrigin', False):
            return
        
        # Clean up Lambda@Edge function if exists
        lambda_edge_function_id = distribution_record.get('lambdaEdgeFunctionId')
        if lambda_edge_function_id:
            try:
                from aws_clients import get_lambda_client
                lambda_client = get_lambda_client('us-east-1')  # Lambda@Edge must be in us-east-1
                
                # Delete Lambda@Edge function
                lambda_client.delete_function(FunctionName=lambda_edge_function_id)
                logger.info(f"Deleted Lambda@Edge function: {lambda_edge_function_id}")
                
                # Clean up Lambda@Edge function record from DynamoDB
                lambda_edge_table = os.environ.get('LAMBDA_EDGE_FUNCTIONS_TABLE')
                if lambda_edge_table:
                    dynamodb = get_dynamodb_resource()
                    lambda_edge_tbl = dynamodb.Table(lambda_edge_table)
                    lambda_edge_tbl.delete_item(Key={'functionId': lambda_edge_function_id})
                    logger.info(f"Deleted Lambda@Edge function record: {lambda_edge_function_id}")
                    
            except ClientError as lambda_error:
                logger.warning(f"Could not delete Lambda@Edge function {lambda_edge_function_id}: {lambda_error}")
        
        # Clean up OAI from S3 bucket policies
        oai_id = distribution_record.get('oaiId')
        if oai_id:
            try:
                s3_client = get_s3_client()
                origins = distribution_record.get('config', {}).get('Origins', {}).get('Items', [])
                
                for origin in origins:
                    if 'S3OriginConfig' in origin:
                        # Extract bucket name from domain name
                        domain_name = origin.get('DomainName', '')
                        if '.s3.' in domain_name:
                            bucket_name = domain_name.split('.s3.')[0]
                            
                            try:
                                # Get current bucket policy
                                policy_response = s3_client.get_bucket_policy(Bucket=bucket_name)
                                current_policy = json.loads(policy_response['Policy'])
                                
                                # Remove OAI principal from policy
                                oai_principal = f"arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity {oai_id}"
                                
                                for statement in current_policy.get('Statement', []):
                                    principal = statement.get('Principal', {})
                                    if isinstance(principal, dict) and 'AWS' in principal:
                                        aws_principals = principal['AWS']
                                        if isinstance(aws_principals, list):
                                            if oai_principal in aws_principals:
                                                aws_principals.remove(oai_principal)
                                                if not aws_principals:
                                                    # Remove the entire statement if no principals left
                                                    current_policy['Statement'].remove(statement)
                                        elif aws_principals == oai_principal:
                                            # Remove the entire statement
                                            current_policy['Statement'].remove(statement)
                                
                                # Update bucket policy
                                if current_policy.get('Statement'):
                                    s3_client.put_bucket_policy(
                                        Bucket=bucket_name,
                                        Policy=json.dumps(current_policy)
                                    )
                                else:
                                    # Delete policy if no statements left
                                    s3_client.delete_bucket_policy(Bucket=bucket_name)
                                
                                logger.info(f"Cleaned up OAI {oai_id} from bucket {bucket_name} policy")
                                
                            except ClientError as policy_error:
                                if policy_error.response['Error']['Code'] != 'NoSuchBucketPolicy':
                                    logger.warning(f"Could not update bucket policy for {bucket_name}: {policy_error}")
                            
            except Exception as oai_error:
                logger.warning(f"Could not clean up OAI {oai_id}: {oai_error}")
                
    except Exception as cleanup_error:
        logger.warning(f"Error during multi-origin cleanup: {cleanup_error}")

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to delete CloudFront distribution
    
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
        # Get distribution ID from path parameters
        distribution_id = get_path_parameter(event, 'id')
        
        if not distribution_id:
            return cors_response(400, {
                'success': False,
                'message': 'Distribution ID is required'
            })
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        history_table = os.environ.get('HISTORY_TABLE')
        
        if not distributions_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Get distribution record from DynamoDB
        response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Distribution {distribution_id} not found'
            })
        
        distribution_record = response['Item']
        cloudfront_id = distribution_record.get('cloudfrontId')
        
        if not cloudfront_id:
            return cors_response(400, {
                'success': False,
                'message': 'CloudFront ID not found in distribution record'
            })
        
        # Get current distribution configuration from CloudFront
        try:
            cf_response = cloudfront.get_distribution(Id=cloudfront_id)
            distribution_config = cf_response['Distribution']['DistributionConfig']
            etag = cf_response['ETag']
            
            # Disable the distribution first if it's enabled
            if distribution_config.get('Enabled', False):
                logger.info(f"Disabling distribution {cloudfront_id} before deletion")
                
                distribution_config['Enabled'] = False
                
                cloudfront.update_distribution(
                    Id=cloudfront_id,
                    DistributionConfig=distribution_config,
                    IfMatch=etag
                )
                
                # Update status in DynamoDB
                distributions_tbl.update_item(
                    Key={'distributionId': distribution_id},
                    UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': 'Disabling',
                        ':updatedAt': datetime.utcnow().isoformat() + 'Z'
                    }
                )
                
                return cors_response(202, {
                    'success': True,
                    'message': f'Distribution {distribution_id} is being disabled. Please wait for it to be disabled before attempting deletion again.',
                    'data': {
                        'distributionId': distribution_id,
                        'cloudfrontId': cloudfront_id,
                        'status': 'Disabling'
                    }
                })
            
            # Check if distribution is deployed (required for deletion)
            current_status = cf_response['Distribution']['Status']
            if current_status not in ['Deployed']:
                return cors_response(400, {
                    'success': False,
                    'message': f'Distribution must be in Deployed status to be deleted. Current status: {current_status}'
                })
            
            # Delete the CloudFront distribution
            logger.info(f"Deleting CloudFront distribution {cloudfront_id}")
            cloudfront.delete_distribution(
                Id=cloudfront_id,
                IfMatch=etag
            )
            
            # Clean up multi-origin resources if applicable
            cleanup_multi_origin_resources(distribution_record)
            
            # Update status in DynamoDB
            distributions_tbl.update_item(
                Key={'distributionId': distribution_id},
                UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'Deleting',
                    ':updatedAt': datetime.utcnow().isoformat() + 'Z'
                }
            )
            
            # Add history record
            if history_table:
                try:
                    history_tbl = dynamodb.Table(history_table)
                    history_tbl.put_item(
                        Item={
                            'distributionId': distribution_id,
                            'timestamp': datetime.utcnow().isoformat() + 'Z',
                            'action': 'delete',
                            'user': event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'system'),
                            'details': {
                                'cloudfrontId': cloudfront_id,
                                'name': distribution_record.get('name')
                            }
                        }
                    )
                except Exception as history_error:
                    logger.warning(f"Could not add history record: {history_error}")
            
            return cors_response(200, {
                'success': True,
                'message': f'Distribution {distribution_id} deletion initiated successfully',
                'data': {
                    'distributionId': distribution_id,
                    'cloudfrontId': cloudfront_id,
                    'status': 'Deleting'
                }
            })
            
        except ClientError as cf_error:
            error_code = cf_error.response.get('Error', {}).get('Code')
            
            if error_code == 'NoSuchDistribution':
                # Distribution doesn't exist in CloudFront, just remove from DynamoDB
                logger.info(f"Distribution {cloudfront_id} not found in CloudFront, removing from database")
                
                distributions_tbl.delete_item(Key={'distributionId': distribution_id})
                
                return cors_response(200, {
                    'success': True,
                    'message': f'Distribution {distribution_id} removed from database (was not found in CloudFront)',
                    'data': {
                        'distributionId': distribution_id,
                        'cloudfrontId': cloudfront_id,
                        'status': 'Deleted'
                    }
                })
            
            elif error_code == 'DistributionNotDisabled':
                return cors_response(400, {
                    'success': False,
                    'message': 'Distribution must be disabled before it can be deleted'
                })
            
            else:
                raise cf_error
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error deleting distribution: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to delete distribution',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error deleting distribution: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error deleting distribution',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
