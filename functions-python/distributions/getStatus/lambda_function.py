"""
Get CloudFront distribution status - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter
from aws_clients import get_dynamodb_resource, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to get CloudFront distribution status
    
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
        # Get distribution ID from path parameters
        distribution_id = get_path_parameter(event, 'id')
        
        if not distribution_id:
            return cors_response(400, {
                'success': False,
                'message': 'Distribution ID is required'
            })
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        if not distributions_table:
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Get distribution record from DynamoDB
        response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Distribution {distribution_id} not found'
            })
        
        distribution_record = response['Item']
        cloudfront_id = distribution_record.get('cloudfrontId')
        
        if not cloudfront_id:
            return cors_response(400, {
                'success': False,
                'message': 'CloudFront ID not found in distribution record'
            })
        
        # Get current status from CloudFront
        try:
            cf_response = cloudfront.get_distribution(Id=cloudfront_id)
            current_status = cf_response['Distribution']['Status']
            
            # Update DynamoDB if status has changed
            if current_status != distribution_record.get('status'):
                distributions_tbl.update_item(
                    Key={'distributionId': distribution_id},
                    UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': current_status,
                        ':updatedAt': datetime.utcnow().isoformat() + 'Z'
                    }
                )
                logger.info(f"Updated status for {distribution_id} to {current_status}")
            
            return cors_response(200, {
                'success': True,
                'data': {
                    'distributionId': distribution_id,
                    'cloudfrontId': cloudfront_id,
                    'status': current_status,
                    'lastUpdated': distribution_record.get('updatedAt')
                }
            })
            
        except Exception as cf_error:
            logger.error(f"CloudFront error: {cf_error}")
            
            # Return status from DynamoDB if CloudFront call fails
            return cors_response(200, {
                'success': True,
                'data': {
                    'distributionId': distribution_id,
                    'cloudfrontId': cloudfront_id,
                    'status': distribution_record.get('status', 'Unknown'),
                    'lastUpdated': distribution_record.get('updatedAt'),
                    'note': 'Status from database (CloudFront API unavailable)'
                }
            })
        
    except Exception as error:
        logger.error(f'Error getting distribution status: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error getting distribution status',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
