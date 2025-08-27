import json
import boto3
import logging
import os
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Disassociates a WAF Web ACL from a CloudFront distribution
    
    Path parameters:
    - distributionId: The ID of the CloudFront distribution
    """
    try:
        # Extract distribution ID from path parameters
        path_params = event.get('pathParameters') or {}
        distribution_id = path_params.get('distributionId')
        
        if not distribution_id:
            return cors_response(400, {
                'error': 'Missing distribution ID in path parameters'
            })
        
        logger.info(f"Disassociating WAF from distribution: {distribution_id}")
        
        # Initialize AWS clients
        cloudfront_client = boto3.client('cloudfront')
        dynamodb = boto3.resource('dynamodb')
        
        # Get current distribution configuration
        try:
            cf_response = cloudfront_client.get_distribution_config(Id=distribution_id)
            distribution_config = cf_response['DistributionConfig']
            etag = cf_response['ETag']
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchDistribution':
                return cors_response(404, {
                    'error': 'CloudFront distribution not found'
                })
            raise
        
        # Check if a WAF is currently associated
        current_web_acl_arn = distribution_config.get('WebACLId', '')
        if not current_web_acl_arn:
            return cors_response(200, {
                'distributionId': distribution_id,
                'message': 'No WAF Web ACL is currently associated with this distribution'
            })
        
        # Get Web ACL name for logging
        web_acl_name = 'Unknown'
        web_acl_id = None
        try:
            arn_parts = current_web_acl_arn.split('/')
            web_acl_name = arn_parts[-2] if len(arn_parts) >= 3 else 'Unknown'
            
            # Try to find the Web ACL in our database
            waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
            scan_response = waf_table.scan(
                FilterExpression='arn = :arn',
                ExpressionAttributeValues={':arn': current_web_acl_arn}
            )
            
            if scan_response['Items']:
                web_acl_id = scan_response['Items'][0]['webAclId']
                web_acl_name = scan_response['Items'][0]['name']
                
        except Exception as e:
            logger.warning(f"Could not get Web ACL details: {str(e)}")
        
        # Remove the Web ACL association
        distribution_config['WebACLId'] = ''
        
        # Update the distribution
        logger.info(f"Removing WAF {web_acl_name} from CloudFront distribution {distribution_id}")
        cloudfront_client.update_distribution(
            Id=distribution_id,
            DistributionConfig=distribution_config,
            IfMatch=etag
        )
        
        # Update our Web ACL tracking in DynamoDB
        if web_acl_id:
            await_remove_distribution_from_web_acl(web_acl_id, distribution_id, dynamodb)
        
        # Update distribution record in our database
        await_update_distribution_waf_info(distribution_id, dynamodb, event)
        
        logger.info(f"Successfully disassociated WAF {web_acl_name} from distribution {distribution_id}")
        
        return cors_response(200, {
            'distributionId': distribution_id,
            'previousWebAclArn': current_web_acl_arn,
            'previousWebAclName': web_acl_name,
            'message': 'WAF Web ACL disassociated successfully',
            'status': 'InProgress'  # CloudFront update is asynchronous
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error disassociating WAF: {error_code} - {error_message}")
        
        if error_code == 'PreconditionFailed':
            return cors_response(409, {
                'error': 'Distribution was modified by another process. Please retry.'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to disassociate WAF: {error_message}'
            })
        
    except Exception as e:
        logger.error(f"Unexpected error disassociating WAF: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def await_remove_distribution_from_web_acl(web_acl_id, distribution_id, dynamodb):
    """
    Removes a distribution from the Web ACL's associated distributions list
    """
    try:
        waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Remove distribution from the associated distributions list
        waf_table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression='DELETE associatedDistributions :dist_id SET updatedAt = :timestamp',
            ExpressionAttributeValues={
                ':dist_id': {distribution_id},
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Removed distribution {distribution_id} from Web ACL {web_acl_id} tracking")
        
    except Exception as e:
        logger.warning(f"Could not update Web ACL tracking: {str(e)}")

def await_update_distribution_waf_info(distribution_id, dynamodb, event):
    """
    Removes WAF information from the distribution record
    """
    try:
        distributions_table = dynamodb.Table(os.environ['DISTRIBUTIONS_TABLE'])
        
        # Remove WAF information from distribution record
        distributions_table.update_item(
            Key={'distributionId': distribution_id},
            UpdateExpression='REMOVE wafWebAclArn, wafWebAclName SET updatedAt = :timestamp, updatedBy = :user',
            ExpressionAttributeValues={
                ':timestamp': datetime.utcnow().isoformat(),
                ':user': extract_user_from_event(event)
            }
        )
        
        logger.info(f"Removed WAF information from distribution {distribution_id} record")
        
    except Exception as e:
        logger.warning(f"Could not update distribution record: {str(e)}")

def extract_user_from_event(event):
    """
    Extracts user information from the API Gateway event
    """
    try:
        # Try to get user from request context (Cognito authorizer)
        request_context = event.get('requestContext', {})
        authorizer = request_context.get('authorizer', {})
        
        # Check for Cognito user
        claims = authorizer.get('claims', {})
        if claims:
            return claims.get('email', claims.get('username', 'unknown'))
        
        # Fallback to enhanced authorizer context
        user_info = authorizer.get('user', {})
        if user_info:
            return user_info.get('email', user_info.get('username', 'unknown'))
        
        return 'system'
        
    except Exception as e:
        logger.warning(f"Could not extract user from event: {str(e)}")
        return 'unknown'

def cors_response(status_code, body):
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