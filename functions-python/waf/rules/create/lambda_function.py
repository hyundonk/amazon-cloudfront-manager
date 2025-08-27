import json
import boto3
import logging
import os
import uuid
import re
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Adds a new rule to an existing WAF Web ACL
    
    Path: /waf/web-acls/{webAclId}/rules
    Method: POST
    
    Expected request body:
    {
        "name": "Rate Limiting Rule",
        "priority": 1,
        "action": "BLOCK",
        "ruleType": "RATE_BASED",
        "rateLimit": 2000,
        "description": "Blocks IPs making more than 2000 requests per 5 minutes"
    }
    
    Supported rule types:
    - RATE_BASED: Rate limiting based on IP
    - GEO_MATCH: Geographic blocking
    - IP_SET: IP address blocking (requires existing IP set)
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
        
        # Parse request body
        body = extract_request_data(event)
        if not body:
            return cors_response(400, {
                'error': 'Request body is required'
            })
        
        logger.info(f"Adding rule to Web ACL {web_acl_id}: {json.dumps(body, default=str)}")
        
        # Validate required fields
        required_fields = ['name', 'priority', 'action', 'ruleType']
        for field in required_fields:
            if not body.get(field):
                return cors_response(400, {
                    'error': f'Missing required field: {field}'
                })
        
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
        
        # Get current Web ACL configuration from AWS
        waf_response = wafv2_client.get_web_acl(
            Scope='CLOUDFRONT',
            Id=aws_web_acl_id
        )
        
        current_web_acl = waf_response['WebACL']
        lock_token = waf_response['LockToken']
        
        # Create the new rule
        new_rule = create_waf_rule(body)
        if not new_rule:
            return cors_response(400, {
                'error': 'Failed to create rule configuration'
            })
        
        # Check for priority conflicts
        existing_priorities = [rule['Priority'] for rule in current_web_acl['Rules']]
        if new_rule['Priority'] in existing_priorities:
            return cors_response(409, {
                'error': f'Rule priority {new_rule["Priority"]} already exists'
            })
        
        # Add the new rule to the Web ACL
        updated_rules = current_web_acl['Rules'] + [new_rule]
        
        # Update Web ACL in AWS
        wafv2_client.update_web_acl(
            Scope='CLOUDFRONT',
            Id=aws_web_acl_id,
            Name=current_web_acl['Name'],
            DefaultAction=current_web_acl['DefaultAction'],
            Rules=updated_rules,
            Description=current_web_acl.get('Description', ''),
            VisibilityConfig=current_web_acl['VisibilityConfig'],
            LockToken=lock_token
        )
        
        # Generate rule ID and update DynamoDB
        rule_id = f"rule-{uuid.uuid4().hex[:8]}"
        
        # Get sanitized name from the created rule
        sanitized_name = new_rule['Name']
        
        rule_metadata = {
            'ruleId': rule_id,
            'name': sanitized_name,
            'originalName': body['name'],  # Store original name for display
            'priority': body['priority'],
            'action': body['action'],
            'ruleType': body['ruleType'],
            'description': body.get('description', ''),
            'createdAt': datetime.utcnow().isoformat(),
            'createdBy': extract_user_from_event(event)
        }
        
        # Add rule-specific metadata
        if body['ruleType'] == 'RATE_BASED':
            rule_metadata['rateLimit'] = body.get('rateLimit', 2000)
        elif body['ruleType'] == 'GEO_MATCH':
            rule_metadata['countryCodes'] = body.get('countryCodes', [])
        elif body['ruleType'] == 'IP_SET':
            rule_metadata['ipSetArn'] = body.get('ipSetArn', '')
        
        # Update Web ACL item in DynamoDB with new rule
        current_rules = web_acl_item.get('rules', [])
        current_rules.append(rule_metadata)
        
        table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression='SET rules = :rules, updatedAt = :timestamp',
            ExpressionAttributeValues={
                ':rules': current_rules,
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Successfully added rule {rule_id} to Web ACL {web_acl_id}")
        
        return cors_response(201, {
            'ruleId': rule_id,
            'webAclId': web_acl_id,
            'name': sanitized_name,
            'originalName': body['name'],
            'priority': body['priority'],
            'action': body['action'],
            'ruleType': body['ruleType'],
            'message': 'Rule added successfully'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error adding rule: {error_code} - {error_message}")
        
        if error_code == 'WAFOptimisticLockException':
            return cors_response(409, {
                'error': 'Web ACL was modified by another process. Please retry.'
            })
        elif error_code == 'WAFLimitsExceededException':
            return cors_response(429, {
                'error': 'WAF limits exceeded. Maximum number of rules reached.'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to add rule: {error_message}'
            })
            
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return cors_response(400, {
            'error': str(e)
        })
        
    except Exception as e:
        logger.error(f"Unexpected error adding rule: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def create_waf_rule(rule_config):
    """
    Creates a WAF rule configuration based on rule type
    """
    try:
        raw_rule_name = str(rule_config['name']).strip()
        rule_type = rule_config['ruleType']
        priority = int(rule_config['priority'])
        action = rule_config['action'].upper()
        
        # Sanitize rule name for AWS WAF requirements
        # Name must match pattern ^[\w\-]+$ (alphanumeric, underscore, hyphen only)
        sanitized_rule_name = raw_rule_name.replace('"', '').replace("'", "").replace(' ', '-')
        sanitized_rule_name = re.sub(r'[^\w\-]', '', sanitized_rule_name)
        
        if not sanitized_rule_name:
            sanitized_rule_name = f"Rule{uuid.uuid4().hex[:8]}"
        
        # Generate metric name (must match pattern ^[\w#:\.\-/]+$)
        metric_name = sanitized_rule_name.replace('-', '').replace('_', '')[:128]
        if not metric_name:
            metric_name = f"Rule{uuid.uuid4().hex[:8]}"
        
        # Configure action
        if action == 'ALLOW':
            rule_action = {'Allow': {}}
        elif action == 'BLOCK':
            rule_action = {'Block': {}}
        elif action == 'COUNT':
            rule_action = {'Count': {}}
        else:
            raise ValueError(f"Invalid action: {action}. Must be ALLOW, BLOCK, or COUNT")
        
        base_rule = {
            'Name': sanitized_rule_name,
            'Priority': priority,
            'Action': rule_action,
            'VisibilityConfig': {
                'SampledRequestsEnabled': True,
                'CloudWatchMetricsEnabled': True,
                'MetricName': metric_name
            }
        }
        
        # Configure rule statement based on type
        if rule_type == 'RATE_BASED':
            rate_limit = rule_config.get('rateLimit', 2000)
            if rate_limit < 100 or rate_limit > 2000000000:
                raise ValueError("Rate limit must be between 100 and 2,000,000,000")
            
            base_rule['Statement'] = {
                'RateBasedStatement': {
                    'Limit': rate_limit,
                    'AggregateKeyType': 'IP'
                }
            }
            
        elif rule_type == 'GEO_MATCH':
            country_codes = rule_config.get('countryCodes', [])
            if not country_codes:
                raise ValueError("Country codes are required for GEO_MATCH rules")
            
            # Validate country codes (should be 2-letter ISO codes)
            for code in country_codes:
                if not isinstance(code, str) or len(code) != 2:
                    raise ValueError(f"Invalid country code: {code}. Must be 2-letter ISO code")
            
            base_rule['Statement'] = {
                'GeoMatchStatement': {
                    'CountryCodes': country_codes
                }
            }
            
        elif rule_type == 'IP_SET':
            ip_set_arn = rule_config.get('ipSetArn')
            if not ip_set_arn:
                raise ValueError("IP Set ARN is required for IP_SET rules")
            
            base_rule['Statement'] = {
                'IPSetReferenceStatement': {
                    'ARN': ip_set_arn
                }
            }
            
        else:
            raise ValueError(f"Unsupported rule type: {rule_type}")
            
        return base_rule
        
    except Exception as e:
        logger.error(f"Error creating WAF rule: {str(e)}")
        raise

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

def extract_request_data(event):
    """
    Extract and parse request body data
    """
    body = event.get('body')
    if not body:
        return None
    
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in request body: {str(e)}")

def get_path_parameter(event, param_name):
    """
    Extract path parameter from event
    """
    path_params = event.get('pathParameters') or {}
    return path_params.get(param_name)