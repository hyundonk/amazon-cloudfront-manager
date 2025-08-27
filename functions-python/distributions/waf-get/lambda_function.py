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
    Gets the WAF Web ACL associated with a CloudFront distribution
    
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
        
        logger.info(f"Getting WAF association for distribution: {distribution_id}")
        
        # Initialize AWS clients
        cloudfront_client = boto3.client('cloudfront')
        dynamodb = boto3.resource('dynamodb')
        
        # Get distribution configuration from CloudFront
        try:
            cf_response = cloudfront_client.get_distribution_config(Id=distribution_id)
            distribution_config = cf_response['DistributionConfig']
            web_acl_id = distribution_config.get('WebACLId', '')
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'NoSuchDistribution':
                return cors_response(404, {
                    'error': 'CloudFront distribution not found'
                })
            raise
        
        # If no WAF is associated
        if not web_acl_id:
            return cors_response(200, {
                'distributionId': distribution_id,
                'webAcl': None,
                'message': 'No WAF Web ACL is associated with this distribution'
            })
        
        # Get WAF Web ACL details from our database
        waf_table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Find the Web ACL by ARN (since CloudFront stores the ARN)
        scan_response = waf_table.scan(
            FilterExpression='arn = :arn',
            ExpressionAttributeValues={':arn': web_acl_id}
        )
        
        web_acl_details = None
        if scan_response['Items']:
            web_acl_details = scan_response['Items'][0]
        else:
            # Web ACL exists in CloudFront but not in our database
            # Try to get basic info from AWS WAF
            try:
                # WAF Web ACLs for CloudFront must be accessed from us-east-1
                wafv2_client = boto3.client('wafv2', region_name='us-east-1')
                # Extract Web ACL name and ID from ARN
                arn_parts = web_acl_id.split('/')
                if len(arn_parts) >= 3:
                    web_acl_name = arn_parts[-2]
                    aws_web_acl_id = arn_parts[-1]
                    
                    waf_response = wafv2_client.get_web_acl(
                        Scope='CLOUDFRONT',
                        Id=aws_web_acl_id,
                        Name=web_acl_name
                    )
                    
                    web_acl_details = {
                        'webAclId': f"external-{aws_web_acl_id}",
                        'name': web_acl_name,
                        'arn': web_acl_id,
                        'awsId': aws_web_acl_id,
                        'scope': 'CLOUDFRONT',
                        'description': waf_response['WebACL'].get('Description', ''),
                        'defaultAction': list(waf_response['WebACL']['DefaultAction'].keys())[0],
                        'ruleCount': len(waf_response['WebACL'].get('Rules', [])),
                        'managed': False,  # Not managed by our system
                        'createdAt': None,
                        'createdBy': 'external'
                    }
                    
            except Exception as waf_error:
                logger.warning(f"Could not get WAF details from AWS: {str(waf_error)}")
                web_acl_details = {
                    'webAclId': 'unknown',
                    'name': 'Unknown Web ACL',
                    'arn': web_acl_id,
                    'managed': False,
                    'error': 'Could not retrieve Web ACL details'
                }
        
        # Get distribution details from our database
        distributions_table = dynamodb.Table(os.environ['DISTRIBUTIONS_TABLE'])
        dist_response = distributions_table.get_item(
            Key={'distributionId': distribution_id}
        )
        
        distribution_details = None
        if 'Item' in dist_response:
            dist = dist_response['Item']
            distribution_details = {
                'distributionId': distribution_id,
                'name': dist.get('name'),
                'domainName': dist.get('domainName'),
                'status': dist.get('status')
            }
        
        logger.info(f"Found WAF association for distribution {distribution_id}: {web_acl_details.get('name') if web_acl_details else 'None'}")
        
        return cors_response(200, {
            'distributionId': distribution_id,
            'distribution': distribution_details,
            'webAcl': web_acl_details,
            'associatedAt': distribution_config.get('LastModifiedTime', '').isoformat() if hasattr(distribution_config.get('LastModifiedTime', ''), 'isoformat') else None
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error getting WAF association: {error_code} - {error_message}")
        
        return cors_response(500, {
            'error': f'Failed to get WAF association: {error_message}'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error getting WAF association: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

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