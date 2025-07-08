"""
Check CloudFront deployment status - Python implementation
"""
import json
import logging
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from aws_clients import get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to check CloudFront deployment status
    
    Args:
        event: Lambda event dictionary containing distributionId and cloudfrontId
        context: Lambda context object
        
    Returns:
        Status information dictionary
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    try:
        # Extract parameters from the event
        distribution_id = event.get('distributionId')
        cloudfront_id = event.get('cloudfrontId')
        
        if not distribution_id or not cloudfront_id:
            raise ValueError('Missing required parameters: distributionId and cloudfrontId are required')
        
        # Initialize CloudFront client
        cloudfront = get_cloudfront_client()
        
        # Get the current status from CloudFront
        response = cloudfront.get_distribution(Id=cloudfront_id)
        current_status = response['Distribution']['Status']
        
        logger.info(f'CloudFront status for {cloudfront_id}: {current_status}')
        
        # Return the current status and whether it's completed
        return {
            'distributionId': distribution_id,
            'cloudfrontId': cloudfront_id,
            'status': current_status,
            'isCompleted': current_status in ['Deployed', 'Failed']
        }
        
    except Exception as error:
        logger.error(f'Error checking deployment status: {str(error)}')
        raise error
