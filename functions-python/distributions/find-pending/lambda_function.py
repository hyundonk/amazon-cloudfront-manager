"""
Find pending CloudFront distributions - Python implementation
"""
import os
import json
import logging
from typing import Dict, Any, List
from botocore.exceptions import ClientError
from concurrent.futures import ThreadPoolExecutor, as_completed

# Import common utilities
import sys
sys.path.append('/opt/python')
from aws_clients import get_dynamodb_resource, get_lambda_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def invoke_update_status_function(lambda_client, function_name: str, distribution_id: str, cloudfront_id: str) -> str:
    """
    Invoke update status function for a distribution
    
    Args:
        lambda_client: Lambda client
        function_name: Update status function name
        distribution_id: Internal distribution ID
        cloudfront_id: CloudFront distribution ID
        
    Returns:
        Distribution ID if successful, None if failed
    """
    try:
        payload = {
            'distributionId': distribution_id,
            'cloudfrontId': cloudfront_id
        }
        
        lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='Event',  # Asynchronous invocation
            Payload=json.dumps(payload)
        )
        
        logger.info(f"Invoked update status function for {distribution_id}")
        return distribution_id
        
    except Exception as error:
        logger.error(f"Error invoking update status function for {distribution_id}: {error}")
        return None

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to find and process pending distributions
    
    Args:
        event: Lambda event dictionary
        context: Lambda context object
        
    Returns:
        Status response with processed distribution count
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    try:
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        update_status_function_name = os.environ.get('UPDATE_STATUS_FUNCTION_NAME')
        
        if not distributions_table:
            raise ValueError('DISTRIBUTIONS_TABLE environment variable not set')
        
        if not update_status_function_name:
            raise ValueError('UPDATE_STATUS_FUNCTION_NAME environment variable not set')
        
        # Initialize AWS clients
        dynamodb = get_dynamodb_resource()
        lambda_client = get_lambda_client()
        
        distributions_tbl = dynamodb.Table(distributions_table)
        
        # Scan DynamoDB for distributions with non-final statuses
        response = distributions_tbl.scan(
            FilterExpression='#status = :inprogress OR #status = :creating',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':inprogress': 'InProgress',
                ':creating': 'Creating'
            }
        )
        
        # Filter out items without a CloudFront ID
        pending_distributions = [
            item for item in response.get('Items', [])
            if item.get('cloudfrontId')
        ]
        
        logger.info(f"Found {len(pending_distributions)} pending distributions")
        
        if not pending_distributions:
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'No pending distributions found',
                    'processedIds': []
                })
            }
        
        # Process distributions in parallel for better performance
        successful_ids = []
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            # Submit all update status function invocations
            future_to_distribution = {
                executor.submit(
                    invoke_update_status_function,
                    lambda_client,
                    update_status_function_name,
                    dist['distributionId'],
                    dist['cloudfrontId']
                ): dist['distributionId']
                for dist in pending_distributions
            }
            
            # Collect results
            for future in as_completed(future_to_distribution):
                distribution_id = future_to_distribution[future]
                try:
                    result = future.result()
                    if result:
                        successful_ids.append(result)
                except Exception as error:
                    logger.error(f"Error processing distribution {distribution_id}: {error}")
        
        logger.info(f"Successfully processed {len(successful_ids)} distributions")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'Processed {len(successful_ids)} pending distributions',
                'processedIds': successful_ids,
                'totalFound': len(pending_distributions),
                'successfullyProcessed': len(successful_ids)
            })
        }
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error finding pending distributions: {error_code} - {error_message}')
        
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'AWS error finding pending distributions',
                'error': error_message,
                'errorCode': error_code
            })
        }
        
    except Exception as error:
        logger.error(f'Error finding pending distributions: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Error finding pending distributions',
                'error': str(error),
                'errorType': type(error).__name__
            })
        }
