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
    Deletes a rule from a WAF Web ACL
    
    Path: /waf/web-acls/{webAclId}/rules/{ruleId}
    Method: DELETE
    
    Returns:
    {
        "message": "Rule deleted successfully",
        "ruleId": "rule-12345678",
        "webAclId": "waf-acl-12345678",
        "ruleName": "Rate Limiting Rule"
    }
    """
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return handle_cors_preflight()
        
        # Extract parameters from path
        web_acl_id = get_path_parameter(event, 'webAclId')
        rule_id = get_path_parameter(event, 'ruleId')
        
        if not web_acl_id or not rule_id:
            return cors_response(400, {
                'error': 'Missing webAclId or ruleId in path'
            })
        
        logger.info(f"Deleting rule {rule_id} from Web ACL {web_acl_id}")
        
        # Initialize AWS clients
        wafv2_client = boto3.client('wafv2', region_name='us-east-1')
        dynamodb = boto3.resource('dynamodb')
        
        # Get Web ACL from DynamoDB
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        response = table.get_item(Key={'webAclId': web_acl_id})
        
        if 'Item' not in response:
            return cors_response(404, {
                'error': 'Web ACL not found'
            })
        
        web_acl_item = response['Item']
        aws_web_acl_id = web_acl_item['awsId']
        rules = web_acl_item.get('rules', [])
        
        # Find the rule to delete
        rule_index = None
        rule_to_delete = None
        for i, rule in enumerate(rules):
            if rule.get('ruleId') == rule_id:
                rule_index = i
                rule_to_delete = rule
                break
        
        if rule_to_delete is None:
            return cors_response(404, {
                'error': 'Rule not found'
            })
        
        # Get current Web ACL configuration from AWS
        waf_response = wafv2_client.get_web_acl(
            Scope='CLOUDFRONT',
            Id=aws_web_acl_id
        )
        
        current_web_acl = waf_response['WebACL']
        lock_token = waf_response['LockToken']
        
        # Find and remove the AWS rule by name
        updated_aws_rules = []
        rule_found_in_aws = False
        
        for aws_rule in current_web_acl['Rules']:
            if aws_rule['Name'] != rule_to_delete['name']:
                updated_aws_rules.append(aws_rule)
            else:
                rule_found_in_aws = True
                logger.info(f"Found rule '{rule_to_delete['name']}' in AWS WAF, removing it")
        
        if not rule_found_in_aws:
            logger.warning(f"Rule '{rule_to_delete['name']}' not found in AWS WAF, but removing from DynamoDB")
        
        # Update Web ACL in AWS (even if rule wasn't found, to ensure consistency)
        wafv2_client.update_web_acl(
            Scope='CLOUDFRONT',
            Id=aws_web_acl_id,
            Name=current_web_acl['Name'],
            DefaultAction=current_web_acl['DefaultAction'],
            Rules=updated_aws_rules,
            Description=current_web_acl.get('Description', ''),
            VisibilityConfig=current_web_acl['VisibilityConfig'],
            LockToken=lock_token
        )
        
        # Remove rule from DynamoDB
        updated_rules = [rule for i, rule in enumerate(rules) if i != rule_index]
        
        table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression='SET rules = :rules, updatedAt = :timestamp',
            ExpressionAttributeValues={
                ':rules': updated_rules,
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Successfully deleted rule {rule_id} from Web ACL {web_acl_id}")
        
        return cors_response(200, {
            'message': 'Rule deleted successfully',
            'ruleId': rule_id,
            'webAclId': web_acl_id,
            'ruleName': rule_to_delete['name'],
            'deletedAt': datetime.utcnow().isoformat(),
            'deletedBy': extract_user_from_event(event)
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error deleting rule: {error_code} - {error_message}")
        
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
                'error': 'Cannot delete rule while Web ACL is associated with resources'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to delete rule: {error_message}'
            })
            
    except Exception as e:
        logger.error(f"Unexpected error deleting rule: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def extract_user_from_event(event):
    """
    Extracts user information from the API Gateway event
    """
    try:
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

def handle_cors_preflight():
    """
    Handle OPTIONS request for CORS preflight
    """
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true'
        },
        'body': ''
    }

def get_path_parameter(event, param_name):
    """
    Extract path parameter from event
    """
    path_params = event.get('pathParameters') or {}
    return path_params.get(param_name)