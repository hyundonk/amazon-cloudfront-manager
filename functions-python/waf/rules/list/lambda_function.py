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
    Lists all rules for a specific WAF Web ACL
    
    Path: /waf/web-acls/{webAclId}/rules
    Method: GET
    
    Query parameters:
    - priority: Filter by rule priority
    - action: Filter by rule action (ALLOW, BLOCK, COUNT)
    - ruleType: Filter by rule type (RATE_BASED, GEO_MATCH, IP_SET)
    
    Returns:
    {
        "rules": [
            {
                "ruleId": "rule-12345678",
                "name": "Rate Limiting Rule",
                "priority": 1,
                "action": "BLOCK",
                "ruleType": "RATE_BASED",
                "description": "Blocks IPs making more than 2000 requests per 5 minutes",
                "rateLimit": 2000,
                "createdAt": "2025-01-15T10:30:00Z",
                "createdBy": "admin@example.com"
            }
        ],
        "webAclId": "waf-acl-12345678",
        "webAclName": "Production Web ACL",
        "totalRules": 5
    }
    """
    try:
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return handle_cors_preflight()
        
        # Extract Web ACL ID from path
        web_acl_id = get_path_parameter(event, 'webAclId')
        if not web_acl_id:
            return cors_response(400, {
                'error': 'Missing webAclId in path'
            })
        
        logger.info(f"Listing rules for Web ACL: {web_acl_id}")
        
        # Initialize AWS clients
        dynamodb = boto3.resource('dynamodb')
        
        # Get Web ACL from DynamoDB
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        response = table.get_item(Key={'webAclId': web_acl_id})
        
        if 'Item' not in response:
            return cors_response(404, {
                'error': 'Web ACL not found'
            })
        
        web_acl_item = response['Item']
        rules = web_acl_item.get('rules', [])
        
        # Apply filters if provided
        priority_filter = get_query_parameter(event, 'priority')
        action_filter = get_query_parameter(event, 'action')
        rule_type_filter = get_query_parameter(event, 'ruleType')
        
        filtered_rules = rules
        
        if priority_filter:
            try:
                priority_int = int(priority_filter)
                filtered_rules = [rule for rule in filtered_rules if rule.get('priority') == priority_int]
            except ValueError:
                return cors_response(400, {
                    'error': 'Invalid priority filter. Must be an integer.'
                })
        
        if action_filter:
            action_upper = action_filter.upper()
            if action_upper not in ['ALLOW', 'BLOCK', 'COUNT']:
                return cors_response(400, {
                    'error': 'Invalid action filter. Must be ALLOW, BLOCK, or COUNT.'
                })
            filtered_rules = [rule for rule in filtered_rules if rule.get('action', '').upper() == action_upper]
        
        if rule_type_filter:
            rule_type_upper = rule_type_filter.upper()
            if rule_type_upper not in ['RATE_BASED', 'GEO_MATCH', 'IP_SET']:
                return cors_response(400, {
                    'error': 'Invalid ruleType filter. Must be RATE_BASED, GEO_MATCH, or IP_SET.'
                })
            filtered_rules = [rule for rule in filtered_rules if rule.get('ruleType', '').upper() == rule_type_upper]
        
        # Sort rules by priority
        filtered_rules.sort(key=lambda x: x.get('priority', 999))
        
        logger.info(f"Found {len(filtered_rules)} rules for Web ACL {web_acl_id}")
        
        return cors_response(200, {
            'rules': filtered_rules,
            'webAclId': web_acl_id,
            'webAclName': web_acl_item.get('name', ''),
            'totalRules': len(rules),
            'filteredRules': len(filtered_rules)
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error listing rules: {error_code} - {error_message}")
        
        return cors_response(500, {
            'error': f'Failed to list rules: {error_message}'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error listing rules: {str(e)}")
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

def get_query_parameter(event, param_name):
    """
    Extract query parameter from event
    """
    query_params = event.get('queryStringParameters') or {}
    return query_params.get(param_name)