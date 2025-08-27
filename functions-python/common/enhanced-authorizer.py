import json
import logging
import os
import boto3
import jwt
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Enhanced Lambda authorizer with group-based access control
    
    This authorizer validates Cognito JWT tokens and checks user group membership
    for admin-only endpoints.
    """
    try:
        # Extract token from Authorization header
        token = extract_token_from_event(event)
        if not token:
            logger.error("No authorization token provided")
            return generate_policy('user', 'Deny', event['methodArn'])
        
        # Validate the Cognito token
        user_info = validate_cognito_token(token)
        if not user_info:
            logger.error("Invalid or expired token")
            return generate_policy('user', 'Deny', event['methodArn'])
        
        # Extract user details
        username = user_info.get('username', 'unknown')
        email = user_info.get('email', 'unknown')
        groups = user_info.get('cognito:groups', [])
        
        logger.info(f"User authenticated: {username} ({email}) with groups: {groups}")
        
        # Check endpoint permissions
        method_arn = event['methodArn']
        if requires_admin_access(method_arn):
            if 'Administrators' not in groups:
                logger.warning(f"User {username} denied access to admin endpoint: {method_arn}")
                return generate_policy(username, 'Deny', method_arn)
        
        # Generate allow policy with user context
        policy = generate_policy(username, 'Allow', method_arn)
        policy['context'] = {
            'username': username,
            'email': email,
            'groups': ','.join(groups)
        }
        
        logger.info(f"User {username} granted access to: {method_arn}")
        return policy
        
    except Exception as e:
        logger.error(f"Authorization error: {str(e)}")
        return generate_policy('user', 'Deny', event.get('methodArn', '*'))

def extract_token_from_event(event: Dict[str, Any]) -> Optional[str]:
    """
    Extracts the JWT token from the Authorization header
    """
    try:
        auth_header = event.get('authorizationToken', '')
        if auth_header.startswith('Bearer '):
            return auth_header[7:]  # Remove 'Bearer ' prefix
        return auth_header if auth_header else None
    except Exception as e:
        logger.error(f"Error extracting token: {str(e)}")
        return None

def validate_cognito_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Validates a Cognito JWT token and returns user information
    """
    try:
        # Get Cognito user pool information
        user_pool_id = os.environ.get('USER_POOL_ID')
        region = os.environ.get('REGION', 'us-east-1')
        
        if not user_pool_id:
            logger.error("USER_POOL_ID environment variable not set")
            return None
        
        # Initialize Cognito client
        cognito_client = boto3.client('cognito-idp', region_name=region)
        
        # First, try to decode the token to see if it's an ID token or access token
        try:
            # Decode token without verification to get payload
            unverified_payload = jwt.decode(token, options={"verify_signature": False})
            token_use = unverified_payload.get('token_use', 'unknown')
            
            logger.info(f"Token type detected: {token_use}")
            
            if token_use == 'id':
                # Handle ID token - contains user info directly
                return handle_id_token(token, unverified_payload, user_pool_id, cognito_client)
            elif token_use == 'access':
                # Handle access token - need to call get_user
                return handle_access_token(token, cognito_client, user_pool_id)
            else:
                logger.error(f"Unknown token type: {token_use}")
                return None
                
        except jwt.DecodeError as e:
            logger.error(f"Failed to decode token: {str(e)}")
            return None
            
    except Exception as e:
        logger.error(f"Unexpected error validating token: {str(e)}")
        return None

def handle_id_token(token: str, payload: Dict[str, Any], user_pool_id: str, cognito_client) -> Optional[Dict[str, Any]]:
    """
    Handle ID token validation and extract user information
    """
    try:
        # Extract user information from ID token payload
        username = payload.get('cognito:username', payload.get('sub', 'unknown'))
        email = payload.get('email', 'unknown')
        groups = payload.get('cognito:groups', [])
        
        # Verify token is not expired
        import time
        current_time = int(time.time())
        exp = payload.get('exp', 0)
        
        if current_time >= exp:
            logger.error("Token has expired")
            return None
        
        # Verify issuer
        expected_iss = f"https://cognito-idp.{os.environ.get('REGION', 'us-east-1')}.amazonaws.com/{user_pool_id}"
        actual_iss = payload.get('iss', '')
        
        if actual_iss != expected_iss:
            logger.error(f"Invalid token issuer. Expected: {expected_iss}, Got: {actual_iss}")
            return None
        
        user_info = {
            'username': username,
            'email': email,
            'cognito:groups': groups if isinstance(groups, list) else []
        }
        
        # If no groups in token, try to fetch from Cognito
        if not user_info['cognito:groups']:
            try:
                groups_response = cognito_client.admin_list_groups_for_user(
                    UserPoolId=user_pool_id,
                    Username=username
                )
                groups = [group['GroupName'] for group in groups_response.get('Groups', [])]
                user_info['cognito:groups'] = groups
            except ClientError as e:
                logger.warning(f"Could not fetch groups for user {username}: {str(e)}")
                user_info['cognito:groups'] = []
        
        logger.info(f"ID token validated for user: {username} with groups: {user_info['cognito:groups']}")
        return user_info
        
    except Exception as e:
        logger.error(f"Error handling ID token: {str(e)}")
        return None

def handle_access_token(token: str, cognito_client, user_pool_id: str) -> Optional[Dict[str, Any]]:
    """
    Handle access token validation using get_user API
    """
    try:
        # Try to get user info using the access token
        response = cognito_client.get_user(AccessToken=token)
        
        # Extract user attributes
        user_info = {
            'username': response['Username']
        }
        
        # Process user attributes
        for attr in response.get('UserAttributes', []):
            attr_name = attr['Name']
            attr_value = attr['Value']
            
            if attr_name == 'email':
                user_info['email'] = attr_value
            elif attr_name == 'cognito:groups':
                user_info['cognito:groups'] = attr_value.split(',') if attr_value else []
        
        # If no groups found in attributes, try to get groups separately
        if 'cognito:groups' not in user_info:
            try:
                groups_response = cognito_client.admin_list_groups_for_user(
                    UserPoolId=user_pool_id,
                    Username=user_info['username']
                )
                groups = [group['GroupName'] for group in groups_response.get('Groups', [])]
                user_info['cognito:groups'] = groups
            except ClientError as e:
                logger.warning(f"Could not fetch groups for user: {str(e)}")
                user_info['cognito:groups'] = []
        
        logger.info(f"Access token validated for user: {user_info['username']} with groups: {user_info['cognito:groups']}")
        return user_info
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'NotAuthorizedException':
            logger.error("Access token is invalid or expired")
        else:
            logger.error(f"Cognito error: {error_code} - {e.response['Error']['Message']}")
        return None
    except Exception as e:
        logger.error(f"Error handling access token: {str(e)}")
        return None

def requires_admin_access(method_arn: str) -> bool:
    """
    Determines if an endpoint requires administrator access
    """
    admin_endpoints = [
        '/templates',      # Template management
        '/origins',        # Origin management  
        '/certificates',   # Certificate management
        '/settings',       # Settings management
        '/waf'            # WAF management
    ]
    
    # Extract the resource path from the method ARN
    # Format: arn:aws:execute-api:region:account:api-id/stage/method/resource-path
    try:
        arn_parts = method_arn.split('/')
        if len(arn_parts) >= 4:
            resource_path = '/' + '/'.join(arn_parts[3:])
            
            # Check if the resource path starts with any admin endpoint
            for admin_endpoint in admin_endpoints:
                if resource_path.startswith(admin_endpoint):
                    return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error parsing method ARN: {str(e)}")
        # Default to requiring admin access if we can't parse the ARN
        return True

def generate_policy(principal_id: str, effect: str, resource: str) -> Dict[str, Any]:
    """
    Generates an IAM policy for API Gateway
    """
    policy = {
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
    
    return policy