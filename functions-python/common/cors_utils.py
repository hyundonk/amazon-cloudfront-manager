"""
Common CORS utilities for Lambda functions
"""
import json
from typing import Dict, Any, Optional

# CORS headers
CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
}

def cors_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a CORS-enabled response
    
    Args:
        status_code: HTTP status code
        body: Response body dictionary
        
    Returns:
        Lambda response dictionary with CORS headers
    """
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, default=str)  # default=str handles datetime serialization
    }

def handle_cors_preflight() -> Dict[str, Any]:
    """
    Handle OPTIONS request for CORS preflight
    
    Returns:
        Lambda response for OPTIONS request
    """
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': ''
    }

def extract_request_data(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract and parse request body data
    
    Args:
        event: Lambda event dictionary
        
    Returns:
        Parsed request data or None if no body
    """
    body = event.get('body')
    if not body:
        return None
    
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in request body: {str(e)}")

def get_path_parameter(event: Dict[str, Any], param_name: str) -> Optional[str]:
    """
    Extract path parameter from event
    
    Args:
        event: Lambda event dictionary
        param_name: Name of the path parameter
        
    Returns:
        Path parameter value or None
    """
    path_params = event.get('pathParameters') or {}
    return path_params.get(param_name)

def get_query_parameter(event: Dict[str, Any], param_name: str) -> Optional[str]:
    """
    Extract query parameter from event
    
    Args:
        event: Lambda event dictionary
        param_name: Name of the query parameter
        
    Returns:
        Query parameter value or None
    """
    query_params = event.get('queryStringParameters') or {}
    return query_params.get(param_name)
