"""
Get CloudFront distribution details - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

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
    Lambda handler to get CloudFront distribution details
    
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
        history_table = os.environ.get('HISTORY_TABLE')
        
        if not distributions_table or not history_table:
            logger.error('Required environment variables not set')
            return cors_response(500, {
                'success': False,
                'message': 'Server configuration error'
            })
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        history_tbl = dynamodb.Table(history_table)
        
        # Get distribution from DynamoDB
        response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        if 'Item' not in response:
            return cors_response(404, {
                'success': False,
                'message': f'Distribution {distribution_id} not found'
            })
        
        distribution_item = response['Item']
        
        # Get the latest status from CloudFront
        try:
            cf_response = cloudfront.get_distribution(
                Id=distribution_item['cloudfrontId']  # Use actual CloudFront ID
            )
            
            current_status = cf_response['Distribution']['Status']
            
            # Update status if it has changed
            if current_status != distribution_item.get('status'):
                distributions_tbl.update_item(
                    Key={'distributionId': distribution_id},
                    UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
                    ExpressionAttributeNames={'#status': 'status'},
                    ExpressionAttributeValues={
                        ':status': current_status,
                        ':updatedAt': datetime.utcnow().isoformat() + 'Z'
                    }
                )
                distribution_item['status'] = current_status
                
        except ClientError as cf_error:
            logger.warning(f"Could not get latest status from CloudFront: {cf_error}")
            # Continue with the stored status
        
        # Get distribution history
        try:
            history_response = history_tbl.query(
                KeyConditionExpression='distributionId = :distributionId',
                ExpressionAttributeValues={':distributionId': distribution_id},
                Limit=10,
                ScanIndexForward=False  # Get most recent first
            )
            history_items = history_response.get('Items', [])
        except ClientError as history_error:
            logger.warning(f"Could not get distribution history: {history_error}")
            history_items = []
        
        # Format response
        distribution_data = {
            'id': distribution_item.get('distributionId'),
            'cloudfrontId': distribution_item.get('cloudfrontId'),
            'name': distribution_item.get('name'),
            'status': distribution_item.get('status'),
            'domainName': distribution_item.get('domainName'),
            'arn': distribution_item.get('arn'),
            'config': distribution_item.get('config'),
            'tags': distribution_item.get('tags', {}),
            'createdBy': distribution_item.get('createdBy'),
            'createdAt': distribution_item.get('createdAt'),
            'updatedBy': distribution_item.get('updatedBy'),
            'updatedAt': distribution_item.get('updatedAt'),
            'version': distribution_item.get('version')
        }
        
        history_data = [
            {
                'timestamp': item.get('timestamp'),
                'action': item.get('action'),
                'user': item.get('user'),
                'version': item.get('version')
            }
            for item in history_items
        ]
        
        return cors_response(200, {
            'success': True,
            'data': {
                'distribution': distribution_data,
                'history': history_data
            }
        })
        
    except Exception as error:
        logger.error(f'Error getting distribution: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error getting distribution',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
