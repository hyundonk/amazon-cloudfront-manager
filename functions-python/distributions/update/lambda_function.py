"""
Update CloudFront distribution - Python implementation
"""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter, extract_request_data
from aws_clients import get_dynamodb_resource, get_cloudfront_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to update CloudFront distribution
    
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
        
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'message': 'Request body is required'
            })
        
        # Check environment variables
        distributions_table = os.environ.get('DISTRIBUTIONS_TABLE')
        history_table = os.environ.get('HISTORY_TABLE')
        
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
        
        # For now, this is a placeholder implementation
        # Full CloudFront distribution updates are complex and require careful handling
        # of the distribution configuration, ETag management, and deployment status
        
        logger.info(f"Update request received for distribution {distribution_id}")
        logger.info(f"Update data: {json.dumps(request_data)}")
        
        # Update the record in DynamoDB with any provided metadata
        update_expression_parts = []
        expression_attribute_values = {}
        expression_attribute_names = {}
        
        # Always update the updatedAt timestamp
        update_expression_parts.append('updatedAt = :updatedAt')
        expression_attribute_values[':updatedAt'] = datetime.utcnow().isoformat() + 'Z'
        
        # Update allowed fields (metadata only for now)
        updatable_fields = ['name', 'description']
        
        for field in updatable_fields:
            if field in request_data:
                if field == 'name':
                    # Name is a reserved word in DynamoDB
                    update_expression_parts.append('#name = :name')
                    expression_attribute_names['#name'] = 'name'
                    expression_attribute_values[':name'] = request_data[field]
                else:
                    update_expression_parts.append(f'{field} = :{field}')
                    expression_attribute_values[f':{field}'] = request_data[field]
        
        if len(update_expression_parts) > 1:  # More than just updatedAt
            update_expression = 'SET ' + ', '.join(update_expression_parts)
            
            update_kwargs = {
                'Key': {'distributionId': distribution_id},
                'UpdateExpression': update_expression,
                'ExpressionAttributeValues': expression_attribute_values
            }
            
            if expression_attribute_names:
                update_kwargs['ExpressionAttributeNames'] = expression_attribute_names
            
            distributions_tbl.update_item(**update_kwargs)
            
            logger.info(f"Updated distribution metadata: {distribution_id}")
        
        # Record the update attempt in history
        if history_table:
            try:
                history_tbl = dynamodb.Table(history_table)
                user = event.get('requestContext', {}).get('authorizer', {}).get('claims', {}).get('email', 'system')
                
                history_tbl.put_item(
                    Item={
                        'distributionId': distribution_id,
                        'timestamp': datetime.utcnow().isoformat() + 'Z',
                        'action': 'UPDATE_ATTEMPTED',
                        'user': user,
                        'details': request_data
                    }
                )
            except Exception as history_error:
                logger.warning(f"Could not record update history: {history_error}")
        
        # Get updated distribution record
        updated_response = distributions_tbl.get_item(
            Key={'distributionId': distribution_id}
        )
        
        updated_record = updated_response['Item']
        
        return cors_response(200, {
            'success': True,
            'data': {
                'distribution': {
                    'id': updated_record.get('distributionId'),
                    'name': updated_record.get('name'),
                    'description': updated_record.get('description'),
                    'status': updated_record.get('status'),
                    'cloudfrontId': updated_record.get('cloudfrontId'),
                    'updatedAt': updated_record.get('updatedAt')
                }
            },
            'message': f'Distribution {distribution_record.get("name", distribution_id)} metadata updated successfully',
            'note': 'Full CloudFront configuration updates are not yet implemented. Only metadata updates are supported.'
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error updating distribution: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Failed to update distribution',
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error updating distribution: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'message': 'Error updating distribution',
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
