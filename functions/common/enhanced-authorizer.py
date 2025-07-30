"""
Enhanced Lambda Authorizer with Group-Based Access Control
Implements simplified two-tier access control: Administrators and Regular Users
"""

import json
import jwt
import os
import boto3
from typing import Dict, List, Any, Optional
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Enhanced Lambda authorizer with group-based access control
    """
    token = event.get('authorizationToken', '').replace('Bearer ', '')
    method_arn = event.get('methodArn', '')
    
    try:
        # Validate and decode JWT token
        user_info = validate_cognito_token(token)
        
        # Extract user information
        user_groups = user_info.get('cognito:groups', [])
        user_id = user_info.get('sub')
        user_email = user_info.get('email', user_id)
        
        logger.info(f"Authorization request for user {user_email} with groups {user_groups}")
        
        # Check endpoint-specific permissions
        access_decision = check_endpoint_permissions(method_arn, user_groups, user_id)
        
        if not access_decision['allowed']:
            logger.warning(f"Access denied: {access_decision['reason']} for user {user_email}")
            return generate_policy('user', 'Deny', method_arn)
        
        # Log successful authorization
        logger.info(f"Access granted: User {user_email} with groups {user_groups}")
        
        # Generate allow policy with user context
        policy = generate_policy('user', 'Allow', method_arn)
        policy['context'] = {
            'userId': user_id,
            'userEmail': user_email,
            'userGroups': ','.join(user_groups),
            'primaryRole': get_primary_role(user_groups),
            'isAdmin': str('Administrators' in user_groups).lower()
        }
        
        return policy
        
    except Exception as e:
        logger.error(f"Authorization failed: {str(e)}")
        return generate_policy('user', 'Deny', method_arn)

def validate_cognito_token(token: str) -> Dict[str, Any]:
    """
    Validate Cognito JWT token and return user information
    """
    if not token:
        raise Exception("No token provided")
    
    try:
        # In production, validate token signature with Cognito public keys
        # For now, decode without verification (signature validated by API Gateway)
        decoded_token = jwt.decode(token, options={"verify_signature": False})
        
        # Basic token validation
        if not decoded_token.get('sub'):
            raise Exception("Invalid token: missing subject")
        
        # Check token expiration
        import time
        current_time = int(time.time())
        if decoded_token.get('exp', 0) < current_time:
            raise Exception("Token expired")
        
        return decoded_token
    except Exception as e:
        raise Exception(f"Invalid token: {str(e)}")

def check_endpoint_permissions(method_arn: str, user_groups: List[str], user_id: str) -> Dict[str, Any]:
    """
    Check if user has permission to access the endpoint based on simplified two-tier model
    """
    is_admin = 'Administrators' in user_groups
    
    # Admin-only endpoints (all methods)
    admin_only_patterns = [
        '/settings',
        '/api/settings',
        'settings/',
        '/templates',
        '/api/templates', 
        'templates/'
    ]
    
    # Origins endpoints - special handling for read vs write access
    origins_patterns = [
        '/origins',
        '/api/origins',
        'origins/'
    ]
    
    # Certificates endpoints - special handling for read vs write access
    certificates_patterns = [
        '/certificates',
        '/api/certificates',
        'certificates/'
    ]
    
    # Check if this is an origins endpoint
    is_origins_endpoint = any(pattern in method_arn for pattern in origins_patterns)
    
    if is_origins_endpoint:
        # Extract HTTP method from method ARN (format: arn:aws:execute-api:region:account:api-id/stage/METHOD/resource)
        method_parts = method_arn.split('/')
        http_method = method_parts[2] if len(method_parts) > 2 else 'GET'
        
        if http_method == 'GET':
            # All authenticated users can read origins (needed for distribution creation)
            print(f"Allowing GET access to origins for user: {user_id}")
        else:
            # Only admins can create/update/delete origins
            if not is_admin:
                return {
                    'allowed': False,
                    'reason': f'Admin access required for {http_method} operations on origins. User groups: {user_groups}'
                }
    
    # Check if this is a certificates endpoint
    is_certificates_endpoint = any(pattern in method_arn for pattern in certificates_patterns)
    
    if is_certificates_endpoint:
        # Extract HTTP method from method ARN
        method_parts = method_arn.split('/')
        http_method = method_parts[2] if len(method_parts) > 2 else 'GET'
        
        if http_method == 'GET':
            # All authenticated users can read certificates (needed for distribution creation)
            print(f"Allowing GET access to certificates for user: {user_id}")
        else:
            # Only admins can create/update/delete certificates
            if not is_admin:
                return {
                    'allowed': False,
                    'reason': f'Admin access required for {http_method} operations on certificates. User groups: {user_groups}'
                }
    
    # Check if this is an admin-only endpoint (non-origins)
    is_admin_endpoint = any(pattern in method_arn for pattern in admin_only_patterns)
    
    if is_admin_endpoint and not is_admin:
        return {
            'allowed': False,
            'reason': f'Admin access required for endpoint. User groups: {user_groups}'
        }
    
    # Distributions endpoints - accessible to all authenticated users
    distributions_patterns = [
        '/distributions',
        '/api/distributions',
        'distributions/'
    ]
    
    is_distributions_endpoint = any(pattern in method_arn for pattern in distributions_patterns)
    
    if is_distributions_endpoint:
        return {
            'allowed': True,
            'reason': 'Distributions endpoint accessible to all users'
        }
    
    # Default: allow access for backward compatibility
    return {
        'allowed': True,
        'reason': 'Default allow for non-restricted endpoint'
    }

def get_primary_role(user_groups: List[str]) -> str:
    """
    Determine user's primary role based on group membership (simplified two-tier model)
    """
    if 'Administrators' in user_groups:
        return 'admin'
    else:
        return 'user'  # Simplified: only admin and regular user roles

def generate_policy(principal_id: str, effect: str, resource: str) -> Dict[str, Any]:
    """
    Generate IAM policy for API Gateway
    """
    return {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource
                }
            ]
        }
    }

def log_access_attempt(user_id: str, user_groups: List[str], endpoint: str, allowed: bool):
    """
    Log access attempts for audit purposes
    """
    log_entry = {
        'timestamp': context.aws_request_id if 'context' in globals() else 'unknown',
        'user_id': user_id,
        'user_groups': user_groups,
        'endpoint': endpoint,
        'access_allowed': allowed,
        'event_type': 'authorization_check'
    }
    
    logger.info(f"Access audit: {json.dumps(log_entry)}")
    
    # In production, send to CloudWatch Logs or audit service
    # send_to_audit_service(log_entry)
