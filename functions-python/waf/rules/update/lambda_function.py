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
    Updates an existing rule in a WAF Web ACL
    
    Path: /waf/web-acls/{webAclId}/rules/{ruleId}
    Method: PUT
    
    Expected request body:
    {
        "name": "Updated Rate Limiting Rule",
        "priority": 2,
        "action": "COUNT",
        "ruleType": "RATE_BASED",
        "rateLimit": 1500,
        "description": "Updated description"
    }
    
    Note: Changing rule type is not supported. Create a new rule instead.
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
        
        # Parse request body
        body = extract_request_data(event)
        if not body:
            return cors_response(400, {
                'error': 'Request body is required'
            })
        
        logger.info(f"Updating rule {rule_id} in Web ACL {web_acl_id}: {json.dumps(body, default=str)}")
        
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
        
        # Find the rule to update
        rule_index = None
        current_rule = None
        for i, rule in enumerate(rules):
            if rule.get('ruleId') == rule_id:
                rule_index = i
                current_rule = rule
                break
        
        if current_rule is None:
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
        
        # Find the AWS rule by name (since we don't store AWS rule IDs)
        aws_rule_index = None
        for i, aws_rule in enumerate(current_web_acl['Rules']):
            if aws_rule['Name'] == current_rule['name']:
                aws_rule_index = i
                break
        
        if aws_rule_index is None:
            return cors_response(404, {
                'error': 'Rule not found in AWS WAF'
            })
        
        # Validate rule type consistency
        if 'ruleType' in body and body['ruleType'] != current_rule.get('ruleType'):
            return cors_response(400, {
                'error': 'Cannot change rule type. Delete and create a new rule instead.'
            })
        
        # Prepare updated rule metadata
        updated_rule_metadata = current_rule.copy()
        
        # Update allowed fields
        if 'name' in body:
            updated_rule_metadata['name'] = body['name']
        if 'priority' in body:
            new_priority = int(body['priority'])
            # Check for priority conflicts (excluding current rule)
            existing_priorities = [rule['priority'] for i, rule in enumerate(rules) if i != rule_index]
            if new_priority in existing_priorities:
                return cors_response(409, {
                    'error': f'Rule priority {new_priority} already exists'
                })
            updated_rule_metadata['priority'] = new_priority
        if 'action' in body:
            updated_rule_metadata['action'] = body['action']
        if 'description' in body:
            updated_rule_metadata['description'] = body['description']
        
        # Update rule-specific fields
        rule_type = updated_rule_metadata.get('ruleType', 'RATE_BASED')
        if rule_type == 'RATE_BASED' and 'rateLimit' in body:
            rate_limit = int(body['rateLimit'])
            if rate_limit < 100 or rate_limit > 2000000000:
                return cors_response(400, {
                    'error': 'Rate limit must be between 100 and 2,000,000,000'
                })
            updated_rule_metadata['rateLimit'] = rate_limit
        elif rule_type == 'GEO_MATCH' and 'countryCodes' in body:
            country_codes = body['countryCodes']
            if not isinstance(country_codes, list) or not country_codes:
                return cors_response(400, {
                    'error': 'Country codes must be a non-empty list'
                })
            # Validate country codes
            for code in country_codes:
                if not isinstance(code, str) or len(code) != 2:
                    return cors_response(400, {
                        'error': f'Invalid country code: {code}. Must be 2-letter ISO code'
                    })
            updated_rule_metadata['countryCodes'] = country_codes
        elif rule_type == 'IP_SET' and 'ipSetArn' in body:
            updated_rule_metadata['ipSetArn'] = body['ipSetArn']
        
        # Create updated WAF rule configuration
        updated_waf_rule = create_waf_rule(updated_rule_metadata)
        if not updated_waf_rule:
            return cors_response(400, {
                'error': 'Failed to create updated rule configuration'
            })
        
        # Update the rules list for AWS
        updated_aws_rules = current_web_acl['Rules'].copy()
        updated_aws_rules[aws_rule_index] = updated_waf_rule
        
        # Update Web ACL in AWS
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
        
        # Update metadata in DynamoDB
        updated_rule_metadata['updatedAt'] = datetime.utcnow().isoformat()
        updated_rule_metadata['updatedBy'] = extract_user_from_event(event)
        
        # Update the rules list in DynamoDB
        updated_rules = rules.copy()
        updated_rules[rule_index] = updated_rule_metadata
        
        table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression='SET rules = :rules, updatedAt = :timestamp',
            ExpressionAttributeValues={
                ':rules': updated_rules,
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Successfully updated rule {rule_id} in Web ACL {web_acl_id}")
        
        return cors_response(200, {
            'ruleId': rule_id,
            'webAclId': web_acl_id,
            'name': updated_rule_metadata['name'],
            'priority': updated_rule_metadata['priority'],
            'action': updated_rule_metadata['action'],
            'ruleType': updated_rule_metadata['ruleType'],
            'updatedAt': updated_rule_metadata['updatedAt'],
            'message': 'Rule updated successfully'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error updating rule: {error_code} - {error_message}")
        
        if error_code == 'WAFOptimisticLockException':
            return cors_response(409, {
                'error': 'Web ACL was modified by another process. Please retry.'
            })
        elif error_code == 'WAFNonexistentItemException':
            return cors_response(404, {
                'error': 'Web ACL or rule not found in AWS WAF'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to update rule: {error_message}'
            })
            
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return cors_response(400, {
            'error': str(e)
        })
        
    except Exception as e:
        logger.error(f"Unexpected error updating rule: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def create_waf_rule(rule_metadata):
    """
    Creates a WAF rule configuration from metadata
    """
    try:
        rule_name = rule_metadata['name']
        rule_type = rule_metadata['ruleType']
        priority = int(rule_metadata['priority'])
        action = rule_metadata['action'].upper()
        
        # Configure action
        if action == 'ALLOW':
            rule_action = {'Allow': {}}
        elif action == 'BLOCK':
            rule_action = {'Block': {}}
        elif action == 'COUNT':
            rule_action = {'Count': {}}
        else:
            raise ValueError(f"Invalid action: {action}")
        
        base_rule = {
            'Name': rule_name,
            'Priority': priority,
            'Action': rule_action,
            'VisibilityConfig': {
                'SampledRequestsEnabled': True,
                'CloudWatchMetricsEnabled': True,
                'MetricName': rule_name.replace(' ', '').replace('-', '').replace('_', '')[:128]
            }
        }
        
        # Configure rule statement based on type
        if rule_type == 'RATE_BASED':
            rate_limit = rule_metadata.get('rateLimit', 2000)
            base_rule['Statement'] = {
                'RateBasedStatement': {
                    'Limit': rate_limit,
                    'AggregateKeyType': 'IP'
                }
            }
            
        elif rule_type == 'GEO_MATCH':
            country_codes = rule_metadata.get('countryCodes', [])
            base_rule['Statement'] = {
                'GeoMatchStatement': {
                    'CountryCodes': country_codes
                }
            }
            
        elif rule_type == 'IP_SET':
            ip_set_arn = rule_metadata.get('ipSetArn', '')
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