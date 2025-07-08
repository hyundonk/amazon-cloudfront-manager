"""
AWS client initialization utilities
"""
import boto3
from typing import Optional

def get_dynamodb_client(region: Optional[str] = None):
    """Get DynamoDB client"""
    return boto3.client('dynamodb', region_name=region)

def get_dynamodb_resource(region: Optional[str] = None):
    """Get DynamoDB resource (higher-level interface)"""
    return boto3.resource('dynamodb', region_name=region)

def get_cloudfront_client():
    """Get CloudFront client (always uses us-east-1 for global service)"""
    return boto3.client('cloudfront', region_name='us-east-1')

def get_s3_client(region: Optional[str] = None):
    """Get S3 client"""
    return boto3.client('s3', region_name=region)

def get_lambda_client(region: Optional[str] = None):
    """Get Lambda client"""
    return boto3.client('lambda', region_name=region)

def get_stepfunctions_client(region: Optional[str] = None):
    """Get Step Functions client"""
    return boto3.client('stepfunctions', region_name=region)

def get_acm_client():
    """Get ACM client (always uses us-east-1 for CloudFront certificates)"""
    return boto3.client('acm', region_name='us-east-1')
