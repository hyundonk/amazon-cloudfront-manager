"""
Get SSL certificate details from ACM - Python implementation
"""
import json
import logging
from datetime import datetime
from typing import Dict, Any
from urllib.parse import unquote
from botocore.exceptions import ClientError

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, get_path_parameter
from aws_clients import get_acm_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to get SSL certificate details from ACM
    
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
        # Get certificate ARN from path parameters
        certificate_arn = get_path_parameter(event, 'arn')
        
        if not certificate_arn:
            return cors_response(400, {
                'success': False,
                'message': 'Certificate ARN is required'
            })
        
        # URL decode the ARN (in case it was encoded)
        certificate_arn = unquote(certificate_arn)
        
        logger.info(f"Getting certificate details for ARN: {certificate_arn}")
        
        # Initialize ACM client (always us-east-1 for CloudFront)
        acm = get_acm_client()
        
        # Get certificate details
        response = acm.describe_certificate(CertificateArn=certificate_arn)
        cert = response['Certificate']
        
        # Build certificate details
        certificate_details = {
            'arn': cert.get('CertificateArn'),
            'domainName': cert.get('DomainName'),
            'subjectAlternativeNames': cert.get('SubjectAlternativeNames', []),
            'status': cert.get('Status'),
            'type': cert.get('Type'),
            'keyAlgorithm': cert.get('KeyAlgorithm'),
            'keyUsages': cert.get('KeyUsages', []),
            'extendedKeyUsages': cert.get('ExtendedKeyUsages', []),
            'createdAt': cert.get('CreatedAt'),
            'issuedAt': cert.get('IssuedAt'),
            'notBefore': cert.get('NotBefore'),
            'notAfter': cert.get('NotAfter'),
            'renewalEligibility': cert.get('RenewalEligibility'),
            'serial': cert.get('Serial'),
            'subject': cert.get('Subject'),
            'issuer': cert.get('Issuer'),
            'domainValidationOptions': cert.get('DomainValidationOptions', []),
            'inUseBy': cert.get('InUseBy', []),
            'failureReason': cert.get('FailureReason'),
            'options': cert.get('Options')
        }
        
        # Calculate days until expiration
        not_after = cert.get('NotAfter')
        if not_after:
            if isinstance(not_after, str):
                expiration_date = datetime.fromisoformat(not_after.replace('Z', '+00:00'))
            else:
                expiration_date = not_after
            
            now = datetime.now(expiration_date.tzinfo)
            days_until_expiration = (expiration_date - now).days
            
            certificate_details['daysUntilExpiration'] = days_until_expiration
            certificate_details['isExpiringSoon'] = days_until_expiration < 30
            certificate_details['isExpired'] = days_until_expiration < 0
        
        logger.info(f"Retrieved certificate details for domain: {cert.get('DomainName')}")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'certificate': certificate_details
            }
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error getting certificate: {error_code} - {error_message}')
        
        if error_code == 'ResourceNotFoundException':
            return cors_response(404, {
                'success': False,
                'message': 'Certificate not found'
            })
        elif error_code == 'InvalidArnException':
            return cors_response(400, {
                'success': False,
                'message': 'Invalid certificate ARN format'
            })
        
        return cors_response(500, {
            'success': False,
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error getting certificate: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
