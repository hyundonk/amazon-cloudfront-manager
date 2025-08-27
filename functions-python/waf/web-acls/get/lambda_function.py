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
    Gets detailed information about a specific WAF Web ACL
    
    Path parameters:
    - webAclId: The ID of the Web ACL to retrieve
    """
    try:
        # Extract Web ACL ID from path parameters
        path_params = event.get('pathParameters') or {}
        web_acl_id = path_params.get('id')
        
        if not web_acl_id:
            return cors_response(400, {
                'error': 'Missing Web ACL ID in path parameters'
            })
        
        logger.info(f"Getting WAF Web ACL details for ID: {web_acl_id}")
        
        # Initialize DynamoDB
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Get Web ACL from DynamoDB
        response = table.get_item(
            Key={'webAclId': web_acl_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'error': 'Web ACL not found'
            })
        
        web_acl = response['Item']
        
        # Get current status from AWS WAF
        try:
            # WAF Web ACLs for CloudFront must be accessed from us-east-1
            wafv2_client = boto3.client('wafv2', region_name='us-east-1')
            aws_response = wafv2_client.get_web_acl(
                Scope='CLOUDFRONT',
                Id=web_acl.get('awsId'),
                Name=web_acl.get('name')
            )
            
            # Add live AWS data
            web_acl['awsStatus'] = 'ACTIVE'
            web_acl['capacity'] = aws_response['WebACL'].get('Capacity', 0)
            web_acl['lockToken'] = aws_response.get('LockToken')
            
        except ClientError as aws_error:
            logger.warning(f"Could not fetch live AWS data: {aws_error}")
            web_acl['awsStatus'] = 'UNKNOWN'
            web_acl['capacity'] = 0
        
        # Add computed fields
        web_acl['ruleCount'] = len(web_acl.get('rules', []))
        web_acl['distributionCount'] = len(web_acl.get('associatedDistributions', []))
        
        # Get associated distributions details if any
        if web_acl.get('associatedDistributions'):
            web_acl['distributionDetails'] = get_distribution_details(
                web_acl['associatedDistributions']
            )
        
        logger.info(f"Successfully retrieved Web ACL: {web_acl_id}")
        
        return cors_response(200, web_acl)
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error getting Web ACL: {error_code} - {error_message}")
        
        if error_code == 'WAFNonexistentItemException':
            return cors_response(404, {
                'error': 'Web ACL not found in AWS WAF'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to get Web ACL: {error_message}'
            })
        
    except Exception as e:
        logger.error(f"Unexpected error getting Web ACL: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def get_distribution_details(distribution_ids):
    """
    Gets basic details for associated CloudFront distributions
    """
    try:
        dynamodb = boto3.resource('dynamodb')
        distributions_table = dynamodb.Table(os.environ['DISTRIBUTIONS_TABLE'])
        
        distribution_details = []
        
        for dist_id in distribution_ids:
            try:
                response = distributions_table.get_item(
                    Key={'distributionId': dist_id}
                )
                
                if 'Item' in response:
                    dist = response['Item']
                    distribution_details.append({
                        'distributionId': dist.get('distributionId'),
                        'name': dist.get('name'),
                        'domainName': dist.get('domainName'),
                        'status': dist.get('status'),
                        'createdAt': dist.get('createdAt')
                    })
                else:
                    # Distribution not found in our table, add placeholder
                    distribution_details.append({
                        'distributionId': dist_id,
                        'name': 'Unknown Distribution',
                        'status': 'UNKNOWN'
                    })
                    
            except Exception as e:
                logger.warning(f"Could not get details for distribution {dist_id}: {str(e)}")
                distribution_details.append({
                    'distributionId': dist_id,
                    'name': 'Error Loading',
                    'status': 'ERROR'
                })
        
        return distribution_details
        
    except Exception as e:
        logger.warning(f"Error getting distribution details: {str(e)}")
        return []

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