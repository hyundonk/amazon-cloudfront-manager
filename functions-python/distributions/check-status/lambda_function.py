"""
Check CloudFront distribution status - Python implementation
"""
import os
import json
import logging
import time
from datetime import datetime
from typing import Dict, Any, Tuple
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from aws_clients import get_dynamodb_resource, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def trigger_lambda_edge_replication(cloudfront_client, distribution_id: str, 
                                  distribution_record: Dict[str, Any]) -> bool:
    """
    Trigger Lambda@Edge replication by updating CloudFront distribution
    This mimics what the AWS console does to force immediate replication
    
    Args:
        cloudfront_client: CloudFront client
        distribution_id: Internal distribution ID
        distribution_record: Distribution record from DynamoDB
        
    Returns:
        True if successful, False otherwise
    """
    try:
        logger.info(f'Triggering Lambda@Edge replication for distribution: {distribution_id}')
        
        cloudfront_id = distribution_record.get('cloudfrontId')
        if not cloudfront_id:
            logger.error('CloudFront ID not found in distribution record')
            return False
        
        # Get current distribution configuration
        get_response = cloudfront_client.get_distribution(Id=cloudfront_id)
        current_config = get_response['Distribution']['DistributionConfig']
        etag = get_response['ETag']
        
        # Make a small update to trigger Lambda@Edge replication
        base_comment = current_config.get('Comment', '')
        
        # Clean existing replication markers
        import re
        base_comment = re.sub(r'\s*\[Replication:\s*\d+\]$', '', base_comment)
        base_comment = re.sub(r'\s*\[Lambda@Edge Associated:\s*\d+\]$', '', base_comment)
        
        timestamp = int(time.time() * 1000)
        updated_comment = f"{base_comment} [Replication: {timestamp}]"
        
        # Ensure comment doesn't exceed CloudFront limit
        if len(updated_comment) > 128:
            final_comment = f"{base_comment[:100]} [R:{timestamp}]"
        else:
            final_comment = updated_comment
        
        # Update distribution configuration
        updated_config = current_config.copy()
        updated_config['Comment'] = final_comment
        
        cloudfront_client.update_distribution(
            Id=cloudfront_id,
            DistributionConfig=updated_config,
            IfMatch=etag
        )
        
        logger.info(f'Successfully triggered Lambda@Edge replication. Comment updated to: {final_comment}')
        return True
        
    except Exception as error:
        logger.error(f'Failed to trigger Lambda@Edge replication: {error}')
        # Don't fail the entire process if replication trigger fails
        return False

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to check CloudFront distribution status
    
    Args:
        event: Lambda event dictionary containing distributionId and cloudfrontId
        context: Lambda context object
        
    Returns:
        Status information dictionary
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    # Extract parameters from the event
    distribution_id = event.get('distributionId')
    cloudfront_id = event.get('cloudfrontId')
    
    if not distribution_id or not cloudfront_id:
        raise ValueError('Missing required parameters: distributionId and cloudfrontId are required')
    
    try:
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        history_table = os.environ.get('HISTORY_TABLE')
        
        if not distributions_table:
            raise ValueError('DISTRIBUTIONS_TABLE environment variable not set')
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        cloudfront = get_cloudfront_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Get the current distribution from DynamoDB
        get_response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        if 'Item' not in get_response:
            raise ValueError(f'Distribution {distribution_id} not found in DynamoDB')
        
        distribution_record = get_response['Item']
        
        # Get the current status from CloudFront
        cf_response = cloudfront.get_distribution(Id=cloudfront_id)
        current_status = cf_response['Distribution']['Status']
        previous_status = distribution_record.get('status')
        
        logger.info(f'CloudFront status for {cloudfront_id}: {current_status}, Previous status: {previous_status}')
        
        # If status has changed, update DynamoDB
        if current_status != previous_status:
            # Safely handle version increment
            current_version = distribution_record.get('version', 0)
            if not isinstance(current_version, (int, float)):
                current_version = 0
            next_version = int(current_version) + 1
            
            # Update distribution status
            distributions_tbl.update_item(
                Key={'distributionId': distribution_id},
                UpdateExpression='SET #status = :status, updatedAt = :updatedAt, version = :version',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': current_status,
                    ':updatedAt': datetime.utcnow().isoformat() + 'Z',
                    ':version': next_version
                }
            )
            
            # Record history if history table is available
            if history_table:
                try:
                    history_tbl = dynamodb.Table(history_table)
                    history_tbl.put_item(
                        Item={
                            'distributionId': distribution_id,
                            'timestamp': datetime.utcnow().isoformat() + 'Z',
                            'action': 'STATUS_CHANGED',
                            'user': 'system',
                            'version': next_version,
                            'previousStatus': previous_status,
                            'newStatus': current_status
                        }
                    )
                except Exception as history_error:
                    logger.warning(f'Could not record history: {history_error}')
            
            logger.info(f'Updated status for {distribution_id} from {previous_status} to {current_status}')
            
            # Trigger Lambda@Edge replication for multi-origin distributions when they become deployed
            if (current_status == 'Deployed' and 
                previous_status == 'InProgress' and 
                distribution_record.get('isMultiOrigin') is True and 
                distribution_record.get('lambdaEdgeFunctionId')):
                
                logger.info(f'Multi-origin distribution {distribution_id} is now deployed. Triggering Lambda@Edge replication...')
                trigger_lambda_edge_replication(cloudfront, distribution_id, distribution_record)
        else:
            logger.info(f'Status unchanged for {distribution_id}: {current_status}')
        
        # Return the current status and whether it's completed
        return {
            'distributionId': distribution_id,
            'cloudfrontId': cloudfront_id,
            'status': current_status,
            'isCompleted': current_status in ['Deployed', 'Failed']
        }
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error checking distribution status: {error_code} - {error_message}')
        raise Exception(f'AWS error: {error_message}')
        
    except Exception as error:
        logger.error(f'Error checking distribution status: {str(error)}')
        raise error
