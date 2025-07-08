"""
AWS client utilities for CloudFront Manager Lambda functions
"""
import boto3
from typing import Optional

def get_dynamodb_resource(region: Optional[str] = None):
    """Get DynamoDB resource"""
    if region:
        return boto3.resource('dynamodb', region_name=region)
    return boto3.resource('dynamodb')

def get_cloudfront_client(region: str = 'us-east-1'):
    """Get CloudFront client (always us-east-1 for global service)"""
    return boto3.client('cloudfront', region_name=region)

def get_s3_client(region: Optional[str] = None):
    """Get S3 client"""
    if region:
        return boto3.client('s3', region_name=region)
    return boto3.client('s3')

def get_lambda_client(region: Optional[str] = None):
    """Get Lambda client"""
    if region:
        return boto3.client('lambda', region_name=region)
    return boto3.client('lambda')

def get_acm_client(region: str = 'us-east-1'):
    """Get ACM client (us-east-1 for CloudFront certificates)"""
    return boto3.client('acm', region_name=region)

def get_stepfunctions_client(region: Optional[str] = None):
    """Get Step Functions client"""
    if region:
        return boto3.client('stepfunctions', region_name=region)
    return boto3.client('stepfunctions')
