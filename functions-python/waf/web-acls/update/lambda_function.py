import json
import boto3
import logging
import os
import re
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Updates a WAF Web ACL configuration
    
    Path parameters:
    - webAclId: The ID of the Web ACL to update
    
    Expected request body:
    {
        "name": "Updated Web ACL Name",
        "description": "Updated description",
        "defaultAction": "ALLOW",
        "rules": [
            {
                "name": "Updated Rate Limiting",
                "priority": 1,
                "action": "BLOCK",
                "ruleType": "RATE_BASED",
                "rateLimit": 1000
            }
        ]
    }
    """
    try:
        # Extract Web ACL ID from path parameters
        path_params = event.get('pathParameters') or {}
        web_acl_id = path_params.get('id')
        
        if not web_acl_id:
            return cors_response(400, {
                'error': 'Missing Web ACL ID in path parameters'
            })
        
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        logger.info(f"Updating WAF Web ACL {web_acl_id} with data: {json.dumps(body, default=str)}")
        
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
        
        # Get current Web ACL from AWS to get the lock token
        try:
            aws_response = wafv2_client.get_web_acl(
                Scope='CLOUDFRONT',
                Id=existing_web_acl.get('awsId'),
                Name=existing_web_acl.get('name')
            )
            lock_token = aws_response.get('LockToken')
            current_aws_config = aws_response['WebACL']
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'WAFNonexistentItemException':
                return cors_response(404, {
                    'error': 'Web ACL not found in AWS WAF'
                })
            raise
        
        # Sanitize and prepare updated configuration
        raw_name = str(body.get('name', existing_web_acl.get('name', ''))).strip()
        raw_description = str(body.get('description', existing_web_acl.get('description', ''))).strip()
        
        # Sanitize name for AWS WAF requirements
        updated_name = raw_name.replace('"', '').replace("'", "").replace(' ', '-')
        updated_name = re.sub(r'[^\w\-]', '', updated_name)
        
        if not updated_name:
            updated_name = existing_web_acl.get('name', f"WebACL{existing_web_acl.get('webAclId', '')}")
        
        # Sanitize description
        updated_description = raw_description.replace('"', '').replace("'", "")
        if not updated_description:
            updated_description = existing_web_acl.get('description', 'Updated Web ACL')
        
        updated_default_action = body.get('defaultAction', existing_web_acl.get('defaultAction'))
        updated_rules = body.get('rules', existing_web_acl.get('rules', []))
        
        # Build AWS WAF update configuration
        update_config = {
            'Scope': 'CLOUDFRONT',
            'Id': existing_web_acl.get('awsId'),
            'Name': updated_name,
            'DefaultAction': {
                updated_default_action: {}
            },
            'Description': updated_description,
            'Rules': [],
            'VisibilityConfig': current_aws_config.get('VisibilityConfig', {
                'SampledRequestsEnabled': True,
                'CloudWatchMetricsEnabled': True,
                'MetricName': updated_name.replace(' ', '').replace('-', '')
            }),
            'LockToken': lock_token
        }
        
        # Process updated rules
        for rule in updated_rules:
            waf_rule = create_waf_rule(rule)
            if waf_rule:
                update_config['Rules'].append(waf_rule)
        
        # Update Web ACL in AWS WAF
        logger.info(f"Updating Web ACL in AWS: {updated_name}")
        wafv2_client.update_web_acl(**update_config)
        
        # Update metadata in DynamoDB
        update_expression = "SET #name = :name, description = :description, defaultAction = :defaultAction, rules = :rules, updatedAt = :updatedAt, updatedBy = :updatedBy"
        expression_attribute_names = {
            '#name': 'name'  # 'name' is a reserved keyword in DynamoDB
        }
        expression_attribute_values = {
            ':name': updated_name,
            ':description': updated_description,
            ':defaultAction': updated_default_action,
            ':rules': updated_rules,
            ':updatedAt': datetime.utcnow().isoformat(),
            ':updatedBy': extract_user_from_event(event)
        }
        
        table.update_item(
            Key={'webAclId': web_acl_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values
        )
        
        logger.info(f"Successfully updated Web ACL: {web_acl_id}")
        
        return cors_response(200, {
            'webAclId': web_acl_id,
            'name': updated_name,
            'arn': existing_web_acl.get('arn'),
            'message': 'WAF Web ACL updated successfully'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error updating Web ACL: {error_code} - {error_message}")
        
        if error_code == 'WAFOptimisticLockException':
            return cors_response(409, {
                'error': 'Web ACL was modified by another process. Please retry.'
            })
        elif error_code == 'WAFNonexistentItemException':
            return cors_response(404, {
                'error': 'Web ACL not found in AWS WAF'
            })
        elif error_code == 'WAFDuplicateItemException':
            return cors_response(409, {
                'error': 'A Web ACL with this name already exists'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to update Web ACL: {error_message}'
            })
            
    except json.JSONDecodeError:
        logger.error("Invalid JSON in request body")
        return cors_response(400, {
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error updating Web ACL: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def create_waf_rule(rule_config):
    """
    Creates a WAF rule configuration based on rule type
    """
    try:
        raw_rule_name = str(rule_config.get('name', 'DefaultRule')).strip()
        rule_type = rule_config.get('ruleType', 'RATE_BASED')
        priority = rule_config.get('priority', 1)
        action = rule_config.get('action', 'BLOCK')
        
        # Sanitize rule name for AWS WAF requirements
        sanitized_rule_name = raw_rule_name.replace('"', '').replace("'", "").replace(' ', '-')
        sanitized_rule_name = re.sub(r'[^\w\-]', '', sanitized_rule_name)
        
        if not sanitized_rule_name:
            sanitized_rule_name = f"Rule{rule_config.get('priority', 1)}"
        
        # Generate metric name
        metric_name = sanitized_rule_name.replace('-', '').replace('_', '')[:128]
        if not metric_name:
            metric_name = f"Rule{rule_config.get('priority', 1)}"
        
        base_rule = {
            'Name': sanitized_rule_name,
            'Priority': priority,
            'Action': {
                action: {}
            },
            'VisibilityConfig': {
                'SampledRequestsEnabled': True,
                'CloudWatchMetricsEnabled': True,
                'MetricName': metric_name
            }
        }
        
        # Configure rule statement based on type
        if rule_type == 'RATE_BASED':
            base_rule['Statement'] = {
                'RateBasedStatement': {
                    'Limit': rule_config.get('rateLimit', 2000),
                    'AggregateKeyType': 'IP'
                }
            }
        elif rule_type == 'GEO_MATCH':
            base_rule['Statement'] = {
                'GeoMatchStatement': {
                    'CountryCodes': rule_config.get('countryCodes', ['CN', 'RU'])
                }
            }
        elif rule_type == 'IP_SET':
            # Note: This would require creating an IP set first
            # For now, we'll skip IP set rules in the basic implementation
            logger.warning(f"IP_SET rules require additional setup, skipping rule: {rule_name}")
            return None
        else:
            logger.warning(f"Unsupported rule type: {rule_type}")
            return None
            
        return base_rule
        
    except Exception as e:
        logger.error(f"Error creating WAF rule: {str(e)}")
        return None

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