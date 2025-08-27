import json
import boto3
import logging
import os
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Lists WAF Web ACLs with optional filtering
    
    Query parameters:
    - name: Filter by Web ACL name (partial match)
    - scope: Filter by scope (CLOUDFRONT, REGIONAL)
    - limit: Maximum number of results (default: 50)
    """
    try:
        # Parse query parameters
        query_params = event.get('queryStringParameters') or {}
        name_filter = query_params.get('name', '').lower()
        scope_filter = query_params.get('scope', '').upper()
        limit = int(query_params.get('limit', 50))
        
        logger.info(f"Listing WAF Web ACLs with filters - name: {name_filter}, scope: {scope_filter}, limit: {limit}")
        
        # Initialize DynamoDB
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['WAF_WEB_ACLS_TABLE'])
        
        # Scan the table (for small datasets, this is acceptable)
        # For larger datasets, consider using pagination
        scan_kwargs = {}
        if limit:
            scan_kwargs['Limit'] = min(limit, 100)  # Cap at 100 for performance
        
        response = table.scan(**scan_kwargs)
        web_acls = response.get('Items', [])
        
        # Apply filters
        filtered_web_acls = []
        for web_acl in web_acls:
            # Apply name filter
            if name_filter and name_filter not in web_acl.get('name', '').lower():
                continue
            
            # Apply scope filter
            if scope_filter and web_acl.get('scope', '') != scope_filter:
                continue
            
            # Add computed fields
            web_acl['ruleCount'] = len(web_acl.get('rules', []))
            web_acl['distributionCount'] = len(web_acl.get('associatedDistributions', []))
            
            # Remove sensitive or large fields from list view
            list_item = {
                'webAclId': web_acl.get('webAclId'),
                'name': web_acl.get('name'),
                'arn': web_acl.get('arn'),
                'scope': web_acl.get('scope'),
                'description': web_acl.get('description'),
                'defaultAction': web_acl.get('defaultAction'),
                'ruleCount': web_acl['ruleCount'],
                'distributionCount': web_acl['distributionCount'],
                'createdAt': web_acl.get('createdAt'),
                'createdBy': web_acl.get('createdBy'),
                'updatedAt': web_acl.get('updatedAt')
            }
            
            filtered_web_acls.append(list_item)
        
        # Sort by creation date (newest first)
        filtered_web_acls.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
        
        # Apply limit after filtering and sorting
        if limit:
            filtered_web_acls = filtered_web_acls[:limit]
        
        logger.info(f"Found {len(filtered_web_acls)} WAF Web ACLs")
        
        return cors_response(200, {
            'webAcls': filtered_web_acls,
            'count': len(filtered_web_acls),
            'filters': {
                'name': name_filter if name_filter else None,
                'scope': scope_filter if scope_filter else None,
                'limit': limit
            }
        })
        
    except ValueError as e:
        logger.error(f"Invalid parameter: {str(e)}")
        return cors_response(400, {
            'error': 'Invalid query parameters'
        })
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        logger.error(f"AWS error listing Web ACLs: {error_code} - {error_message}")
        
        return cors_response(500, {
            'error': f'Failed to list Web ACLs: {error_message}'
        })
        
    except Exception as e:
        logger.error(f"Unexpected error listing Web ACLs: {str(e)}")
        return cors_response(500, {
            'error': 'Internal server error'
        })

def cors_response(status_code, body):
    """
    Returns a response with CORS headers
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Credentials': 'true'
        },
        'body': json.dumps(body, ensure_ascii=False, default=str)
    }