"""
Update CloudFront distribution status in DynamoDB - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from aws_clients import get_dynamodb_resource

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to update CloudFront distribution status in DynamoDB
    
    Args:
        event: Lambda event dictionary containing status information
        context: Lambda context object
        
    Returns:
        Update confirmation dictionary
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    try:
        # Extract parameters from the event
        distribution_id = event.get('distributionId')
        status = event.get('status')
        
        if not distribution_id or not status:
            raise ValueError('Missing required parameters: distributionId and status are required')
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        if not distributions_table:
            raise ValueError('DISTRIBUTIONS_TABLE environment variable not set')
        
        # Initialize DynamoDB resource
        dynamodb = get_dynamodb_resource()
        table = dynamodb.Table(distributions_table)
        
        # Update distribution status
        table.update_item(
            Key={'distributionId': distribution_id},
            UpdateExpression='SET #status = :status, updatedAt = :updatedAt',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': status,
                ':updatedAt': datetime.utcnow().isoformat() + 'Z'
            }
        )
        
        logger.info(f'Updated status for {distribution_id} to {status}')
        
        return {
            'distributionId': distribution_id,
            'status': status,
            'updated': True
        }
        
    except Exception as error:
        logger.error(f'Error updating distribution status: {str(error)}')
        raise error
