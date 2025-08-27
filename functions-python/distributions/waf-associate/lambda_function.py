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
    Associates a WAF Web ACL with a CloudFront distribution
    
    Path parameters:
    - distributionId: The ID of the CloudFront distribution
    
    Expected request body:
    {
        "webAclId": "waf-acl-123",
        "webAclArn": "arn:aws:wafv2:global:123456789012:webacl/..."  // Optional, will be looked up if not provided
    }
    """
    try:
        # Extract distribution ID from path parameters
        path_params = event.get('pathParameters') or {}
        distribution_id = path_params.get('distributionId')
        
        if not distribution_id:
            return cors_response(400, {
                'error': 'Missing distribution ID in path parameters'
            })
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        web_acl_id = body.get('webAclId')
        web_acl_arn = body.get('webAclArn')
        
        if not web_acl_id and not web_acl_arn:
            return cors_response(400, {
                'error': 'Either webAclId or webAclArn must be provided'
            })
        
        logger.info(f"Associating WAF Web ACL {web_acl_id or web_acl_arn} with distribution: {distribution_id}")
        
        # Initialize AWS clients
        cloudfront_client = boto3.client('cloudfront')
        dynamodb = boto3.resource('dynamodb')
        
        # Get Web ACL details if only ID is provided
        if web_acl_id and not web_acl_arn:
            waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
            waf_response = waf_table.get_item(
                Key={'webAclId': web_acl_id}
            )
            
            if 'Item' not in waf_response:
                return cors_response(404, {
                    'error': 'WAF Web ACL not found'
                })
            
            web_acl_arn = waf_response['Item']['arn']
            web_acl_name = waf_response['Item']['name']
        else:
            # If ARN is provided, extract name for logging
            try:
                arn_parts = web_acl_arn.split('/')
                web_acl_name = arn_parts[-2] if len(arn_parts) >= 3 else 'Unknown'
            except:
                web_acl_name = 'Unknown'
        
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
        
        # Check if a different WAF is already associated
        current_web_acl = distribution_config.get('WebACLId', '')
        if current_web_acl and current_web_acl != web_acl_arn:
            logger.info(f"Distribution {distribution_id} already has WAF {current_web_acl}, replacing with {web_acl_arn}")
            
            # Remove old association from our tracking
            await_remove_distribution_from_web_acl(current_web_acl, distribution_id, dynamodb)
        
        # Associate the Web ACL with the distribution
        distribution_config['WebACLId'] = web_acl_arn
        
        # Update the distribution
        logger.info(f"Updating CloudFront distribution {distribution_id} with WAF {web_acl_name}")
        cloudfront_client.update_distribution(
            Id=distribution_id,
            DistributionConfig=distribution_config,
            IfMatch=etag
        )
        
        # Update our Web ACL tracking in DynamoDB
        if web_acl_id:
            await_add_distribution_to_web_acl(web_acl_id, distribution_id, dynamodb)
        
        # Update distribution record in our database
        await_update_distribution_waf_info(distribution_id, web_acl_arn, web_acl_name, dynamodb, event)
        
        logger.info(f"Successfully associated WAF {web_acl_name} with distribution {distribution_id}")
        
        return cors_response(200, {
            'distributionId': distribution_id,
            'webAclId': web_acl_id,
            'webAclArn': web_acl_arn,
            'webAclName': web_acl_name,
            'message': 'WAF Web ACL associated successfully',
            'status': 'InProgress'  # CloudFront update is asynchronous
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error associating WAF: {error_code} - {error_message}")
        
        if error_code == 'InvalidArgument':
            return cors_response(400, {
                'error': f'Invalid WAF Web ACL ARN: {error_message}'
            })
        elif error_code == 'PreconditionFailed':
            return cors_response(409, {
                'error': 'Distribution was modified by another process. Please retry.'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to associate WAF: {error_message}'
            })
            
    except json.JSONDecodeError:
        logger.error("Invalid JSON in request body")
        return cors_response(400, {
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error associating WAF: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def await_add_distribution_to_web_acl(web_acl_id, distribution_id, dynamodb):
    """
    Adds a distribution to the Web ACL's associated distributions list
    """
    try:
        waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Add distribution to the associated distributions list
        waf_table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression='ADD associatedDistributions :dist_id SET updatedAt = :timestamp',
            ExpressionAttributeValues={
                ':dist_id': {distribution_id},
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Added distribution {distribution_id} to Web ACL {web_acl_id} tracking")
        
    except Exception as e:
        logger.warning(f"Could not update Web ACL tracking: {str(e)}")

def await_remove_distribution_from_web_acl(web_acl_arn, distribution_id, dynamodb):
    """
    Removes a distribution from the Web ACL's associated distributions list
    """
    try:
        waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Find Web ACL by ARN
        scan_response = waf_table.scan(
            FilterExpression='arn = :arn',
            ExpressionAttributeValues={':arn': web_acl_arn}
        )
        
        if scan_response['Items']:
            web_acl_id = scan_response['Items'][0]['webAclId']
            
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
        logger.warning(f"Could not update Web ACL tracking for removal: {str(e)}")

def await_update_distribution_waf_info(distribution_id, web_acl_arn, web_acl_name, dynamodb, event):
    """
    Updates the distribution record with WAF information
    """
    try:
        distributions_table = dynamodb.Table(os.environ['DISTRIBUTIONS_TABLE'])
        
        # Update distribution record
        distributions_table.update_item(
            Key={'distributionId': distribution_id},
            UpdateExpression='SET wafWebAclArn = :arn, wafWebAclName = :name, updatedAt = :timestamp, updatedBy = :user',
            ExpressionAttributeValues={
                ':arn': web_acl_arn,
                ':name': web_acl_name,
                ':timestamp': datetime.utcnow().isoformat(),
                ':user': extract_user_from_event(event)
            }
        )
        
        logger.info(f"Updated distribution {distribution_id} record with WAF information")
        
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