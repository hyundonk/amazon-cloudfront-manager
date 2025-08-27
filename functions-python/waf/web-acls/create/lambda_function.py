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
    Creates a new WAF Web ACL for CloudFront distributions
    
    Expected request body:
    {
        "name": "Production Web ACL",
        "description": "Production environment WAF rules",
        "defaultAction": "ALLOW",
        "rules": [
            {
                "name": "Rate Limiting",
                "priority": 1,
                "action": "BLOCK",
                "ruleType": "RATE_BASED",
                "rateLimit": 2000
            }
        ]
    }
    """
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        logger.info(f"Creating WAF Web ACL with data: {json.dumps(body, default=str)}")
        
        # Validate required fields
        required_fields = ['name', 'description']
        for field in required_fields:
            if not body.get(field):
                return cors_response(400, {
                    'error': f'Missing required field: {field}'
                })
        
        # Sanitize and validate input data
        raw_name = str(body['name']).strip()
        raw_description = str(body['description']).strip()
        
        # Remove quotes and sanitize name for AWS WAF requirements
        # Name must match pattern ^[\w\-]+$ (alphanumeric, underscore, hyphen only)
        sanitized_name = raw_name.replace('"', '').replace("'", "").replace(' ', '-')
        # Remove any characters not allowed in WAF names
        sanitized_name = re.sub(r'[^\w\-]', '', sanitized_name)
        
        if not sanitized_name:
            return cors_response(400, {
                'error': 'Invalid name: Name must contain only alphanumeric characters, underscores, and hyphens'
            })
        
        # Sanitize description - remove quotes but allow more characters
        sanitized_description = raw_description.replace('"', '').replace("'", "")
        
        if not sanitized_description:
            return cors_response(400, {
                'error': 'Invalid description: Description cannot be empty'
            })
        
        # Generate metric name (must match pattern ^[\w#:\.\-/]+$)
        metric_name = sanitized_name.replace('-', '').replace('_', '')[:128]
        if not metric_name:
            metric_name = f"WebACL{uuid.uuid4().hex[:8]}"
        
        # Initialize AWS clients
        # WAF Web ACLs for CloudFront must be created in us-east-1
        wafv2_client = boto3.client('wafv2', region_name='us-east-1')
        dynamodb = boto3.resource('dynamodb')
        
        # Generate unique IDs
        web_acl_id = f"waf-acl-{uuid.uuid4().hex[:8]}"
        caller_reference = f"{sanitized_name}-{int(datetime.utcnow().timestamp())}"
        
        # Prepare Web ACL configuration
        default_action = body.get('defaultAction', 'ALLOW').upper()
        
        # Set default action properly - only one should be present
        if default_action == 'ALLOW':
            default_action_config = {'Allow': {}}
        else:
            default_action_config = {'Block': {}}
        
        web_acl_config = {
            'Name': sanitized_name,
            'Scope': 'CLOUDFRONT',  # CloudFront scope for global distributions
            'DefaultAction': default_action_config,
            'Description': sanitized_description,
            'Rules': [],
            'VisibilityConfig': {
                'SampledRequestsEnabled': True,
                'CloudWatchMetricsEnabled': True,
                'MetricName': metric_name
            }
        }
        
        # Process rules if provided
        rules = body.get('rules', [])
        for rule in rules:
            waf_rule = create_waf_rule(rule)
            if waf_rule:
                web_acl_config['Rules'].append(waf_rule)
        
        # Create Web ACL in AWS WAF
        logger.info(f"Creating Web ACL: {web_acl_config['Name']}")
        waf_response = wafv2_client.create_web_acl(**web_acl_config)
        
        web_acl_arn = waf_response['Summary']['ARN']
        web_acl_aws_id = waf_response['Summary']['Id']
        
        # Store metadata in DynamoDB
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        web_acl_item = {
            'webAclId': web_acl_id,
            'name': sanitized_name,
            'originalName': raw_name,  # Store original name for display
            'arn': web_acl_arn,
            'awsId': web_acl_aws_id,
            'scope': 'CLOUDFRONT',
            'description': sanitized_description,
            'originalDescription': raw_description,  # Store original description for display
            'defaultAction': body.get('defaultAction', 'ALLOW'),
            'rules': rules,
            'associatedDistributions': [],
            'createdAt': datetime.utcnow().isoformat(),
            'createdBy': extract_user_from_event(event),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        table.put_item(Item=web_acl_item)
        
        logger.info(f"Successfully created Web ACL: {web_acl_id}")
        
        return cors_response(201, {
            'webAclId': web_acl_id,
            'name': sanitized_name,
            'originalName': raw_name,
            'arn': web_acl_arn,
            'awsId': web_acl_aws_id,
            'message': 'WAF Web ACL created successfully'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error creating Web ACL: {error_code} - {error_message}")
        
        if error_code == 'WAFDuplicateItemException':
            return cors_response(409, {
                'error': 'A Web ACL with this name already exists'
            })
        elif error_code == 'WAFLimitsExceededException':
            return cors_response(429, {
                'error': 'WAF limits exceeded. Please delete unused Web ACLs or contact AWS support'
            })
        else:
            return cors_response(500, {
                'error': f'Failed to create Web ACL: {error_message}'
            })
            
    except json.JSONDecodeError:
        logger.error("Invalid JSON in request body")
        return cors_response(400, {
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error creating Web ACL: {str(e)}")
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
            sanitized_rule_name = f"Rule{uuid.uuid4().hex[:8]}"
        
        # Generate metric name (must match pattern ^[\w#:\.\-/]+$)
        metric_name = sanitized_rule_name.replace('-', '').replace('_', '')[:128]
        if not metric_name:
            metric_name = f"Rule{uuid.uuid4().hex[:8]}"
        
        # Normalize action to proper case
        action_upper = action.upper()
        rule_action = {}
        if action_upper == 'ALLOW':
            rule_action = {'Allow': {}}
        elif action_upper == 'BLOCK':
            rule_action = {'Block': {}}
        elif action_upper == 'COUNT':
            rule_action = {'Count': {}}
        else:
            rule_action = {'Block': {}}  # Default to Block for safety
        
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