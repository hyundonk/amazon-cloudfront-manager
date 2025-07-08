"""
List CloudFront distributions - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any, List

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to list all CloudFront distributions
    
    Args:
        event: Lambda event dictionary
        context: Lambda context object
        
    Returns:
        API Gateway response with CORS headers
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    # Handle OPTIONS request for CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Check if environment variables are set
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        if not distributions_table:
            logger.error('DISTRIBUTIONS_TABLE environment variable is not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error: DISTRIBUTIONS_TABLE not configured'
            })
        
        logger.info(f'Using DISTRIBUTIONS_TABLE: {distributions_table}')
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(distributions_table)
        
        # Scan all distributions from DynamoDB
        response = table.scan()
        
        logger.info(f"DynamoDB scan result: {json.dumps(response, default=str)}")
        
        # Map the results to a simpler format
        distributions = []
        for item in response.get('Items', []):
            distribution = {
                'id': item.get('distributionId'),
                'cloudfrontId': item.get('cloudfrontId'),
                'name': item.get('name'),
                'status': item.get('status'),
                'domainName': item.get('domainName'),
                'createdAt': item.get('createdAt'),
                'updatedAt': item.get('updatedAt'),
                'createdBy': item.get('createdBy')
            }
            distributions.append(distribution)
        
        logger.info(f"Found {len(distributions)} distributions")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'distributions': distributions
            }
        })
        
    except Exception as error:
        logger.error(f'Error listing distributions: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error listing distributions',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
