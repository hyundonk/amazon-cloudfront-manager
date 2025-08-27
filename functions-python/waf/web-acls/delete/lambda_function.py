import json
import boto3
import logging
import os
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Deletes a WAF Web ACL
    
    Path parameters:
    - webAclId: The ID of the Web ACL to delete
    
    Query parameters:
    - force: Set to 'true' to force deletion even if distributions are associated
    """
    try:
        # Extract Web ACL ID from path parameters
        path_params = event.get('pathParameters') or {}
        web_acl_id = path_params.get('id')
        
        if not web_acl_id:
            return cors_response(400, {
                'error': 'Missing Web ACL ID in path parameters'
            })
        
        # Check for force deletion flag
        query_params = event.get('queryStringParameters') or {}
        force_delete = query_params.get('force', '').lower() == 'true'
        
        logger.info(f"Deleting WAF Web ACL {web_acl_id}, force: {force_delete}")
        
        # Initialize AWS clients
        # WAF Web ACLs for CloudFront must be accessed from us-east-1
        wafv2_client = boto3.client('wafv2', region_name='us-east-1')
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Get existing Web ACL from DynamoDB
        response = table.get_item(
            Key={'webAclId': web_acl_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'error': 'Web ACL not found'
            })
        
        existing_web_acl = response['Item']
        
        # Check for associated distributions
        associated_distributions = existing_web_acl.get('associatedDistributions', [])
        if associated_distributions and not force_delete:
            return cors_response(409, {
                'error': 'Cannot delete Web ACL with associated CloudFront distributions',
                'associatedDistributions': associated_distributions,
                'message': 'Use force=true query parameter to force deletion, or disassociate distributions first'
            })
        
        # If force delete and distributions are associated, disassociate them first
        if force_delete and associated_distributions:
            logger.info(f"Force deleting Web ACL, disassociating {len(associated_distributions)} distributions")
            disassociation_errors = disassociate_distributions(associated_distributions, existing_web_acl.get('arn'))
            
            if disassociation_errors:
                logger.warning(f"Some distributions could not be disassociated: {disassociation_errors}")
                # Continue with deletion anyway since force=true
        
        # Get current Web ACL from AWS to get the lock token
        try:
            aws_response = wafv2_client.get_web_acl(
                Scope='CLOUDFRONT',
                Id=existing_web_acl.get('awsId'),
                Name=existing_web_acl.get('name')
            )
            lock_token = aws_response.get('LockToken')
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'WAFNonexistentItemException':
                # Web ACL doesn't exist in AWS, just remove from DynamoDB
                logger.info("Web ACL not found in AWS, removing from DynamoDB only")
                table.delete_item(Key={'webAclId': web_acl_id})
                
                return cors_response(200, {
                    'webAclId': web_acl_id,
                    'message': 'Web ACL removed from database (was not found in AWS)'
                })
            raise
        
        # Delete Web ACL from AWS WAF
        logger.info(f"Deleting Web ACL from AWS: {existing_web_acl.get('name')}")
        wafv2_client.delete_web_acl(
            Scope='CLOUDFRONT',
            Id=existing_web_acl.get('awsId'),
            Name=existing_web_acl.get('name'),
            LockToken=lock_token
        )
        
        # Remove from DynamoDB
        table.delete_item(Key={'webAclId': web_acl_id})
        
        logger.info(f"Successfully deleted Web ACL: {web_acl_id}")
        
        return cors_response(200, {
            'webAclId': web_acl_id,
            'name': existing_web_acl.get('name'),
            'message': 'WAF Web ACL deleted successfully'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error deleting Web ACL: {error_code} - {error_message}")
        
        if error_code == 'WAFOptimisticLockException':
            return cors_response(409, {
                'error': 'Web ACL was modified by another process. Please retry.'
            })
        elif error_code == 'WAFNonexistentItemException':
            return cors_response(404, {
                'error': 'Web ACL not found in AWS WAF'
            })
        elif error_code == 'WAFAssociatedItemException':
            return cors_response(409, {
                'error': 'Web ACL is still associated with CloudFront distributions. Use force=true to override.'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to delete Web ACL: {error_message}'
            })
        
    except Exception as e:
        logger.error(f"Unexpected error deleting Web ACL: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def disassociate_distributions(distribution_ids, web_acl_arn):
    """
    Disassociates Web ACL from CloudFront distributions
    Returns list of distributions that could not be disassociated
    """
    cloudfront_client = boto3.client('cloudfront')
    errors = []
    
    for dist_id in distribution_ids:
        try:
            logger.info(f"Disassociating Web ACL from distribution: {dist_id}")
            
            # Get current distribution configuration
            response = cloudfront_client.get_distribution_config(Id=dist_id)
            config = response['DistributionConfig']
            etag = response['ETag']
            
            # Remove Web ACL association
            if 'WebACLId' in config:
                config['WebACLId'] = ''
                
                # Update distribution
                cloudfront_client.update_distribution(
                    Id=dist_id,
                    DistributionConfig=config,
                    IfMatch=etag
                )
                
                logger.info(f"Successfully disassociated Web ACL from distribution: {dist_id}")
            else:
                logger.info(f"Distribution {dist_id} was not associated with Web ACL")
                
        except ClientError as e:
            error_msg = f"Failed to disassociate distribution {dist_id}: {e.response['Error']['Message']}"
            logger.error(error_msg)
            errors.append({
                'distributionId': dist_id,
                'error': error_msg
            })
        except Exception as e:
            error_msg = f"Unexpected error disassociating distribution {dist_id}: {str(e)}"
            logger.error(error_msg)
            errors.append({
                'distributionId': dist_id,
                'error': error_msg
            })
    
    return errors

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