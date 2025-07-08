"""
CORS utilities for CloudFront Manager Lambda functions
Updated: 2025-07-07 - Added get_query_parameter function
"""
import json
from typing import Dict, Any, Optional

# Standard CORS headers
CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
}

def cors_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate API Gateway response with CORS headers
    
    Args:
        status_code: HTTP status code
        body: Response body dictionary
        
    Returns:
        API Gateway response with CORS headers
    """
    return {
        'statusCode': status_code,
        'headers': CORS_HEADERS,
        'body': json.dumps(body, default=str)
    }

def handle_cors_preflight() -> Dict[str, Any]:
    """
    Handle OPTIONS request for CORS preflight
    
    Returns:
        API Gateway response for CORS preflight
    """
    return {
        'statusCode': 200,
        'headers': CORS_HEADERS,
        'body': ''
    }

def get_path_parameter(event: Dict[str, Any], parameter_name: str) -> Optional[str]:
    """
    Extract path parameter from API Gateway event
    
    Args:
        event: API Gateway event
        parameter_name: Name of the path parameter
        
    Returns:
        Path parameter value or None if not found
    """
    path_parameters = event.get('pathParameters')
    if not path_parameters:
        return None
    
    return path_parameters.get(parameter_name)

def get_query_parameter(event: Dict[str, Any], parameter_name: str) -> Optional[str]:
    """
    Extract query parameter from API Gateway event
    
    Args:
        event: API Gateway event
        parameter_name: Name of the query parameter
        
    Returns:
        Query parameter value or None if not found
    """
    query_parameters = event.get('queryStringParameters')
    if not query_parameters:
        return None
    
    return query_parameters.get(parameter_name)

def extract_request_data(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract and parse request body from API Gateway event
    
    Args:
        event: API Gateway event
        
    Returns:
        Parsed request data or None if invalid
    """
    body = event.get('body')
    if not body:
        return None
    
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None
