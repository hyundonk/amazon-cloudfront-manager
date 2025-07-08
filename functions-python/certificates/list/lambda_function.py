"""
List SSL certificates from ACM - Python implementation
"""
import json
import logging
from typing import Dict, Any, List
from botocore.exceptions import ClientError
import asyncio
from concurrent.futures import ThreadPoolExecutor

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight
from aws_clients import get_acm_client

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_certificate_details(acm_client, cert_arn: str) -> Dict[str, Any]:
    """
    Get detailed information for a certificate
    
    Args:
        acm_client: ACM client
        cert_arn: Certificate ARN
        
    Returns:
        Certificate details dictionary
    """
    try:
        response = acm_client.describe_certificate(CertificateArn=cert_arn)
        certificate = response['Certificate']
        
        return {
            'arn': cert_arn,
            'domainName': certificate.get('DomainName'),
            'subjectAlternativeNames': certificate.get('SubjectAlternativeNames', []),
            'status': certificate.get('Status'),
            'type': certificate.get('Type'),
            'keyAlgorithm': certificate.get('KeyAlgorithm'),
            'keyUsages': certificate.get('KeyUsages', []),
            'extendedKeyUsages': certificate.get('ExtendedKeyUsages', []),
            'createdAt': certificate.get('CreatedAt'),
            'issuedAt': certificate.get('IssuedAt'),
            'notBefore': certificate.get('NotBefore'),
            'notAfter': certificate.get('NotAfter'),
            'renewalEligibility': certificate.get('RenewalEligibility'),
            'serial': certificate.get('Serial'),
            'subject': certificate.get('Subject'),
            'issuer': certificate.get('Issuer')
        }
    except ClientError as error:
        logger.warning(f"Failed to get details for certificate {cert_arn}: {error}")
        return {
            'arn': cert_arn,
            'error': 'Failed to load certificate details'
        }

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to list SSL certificates from ACM
    
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
        # Initialize ACM client (always us-east-1 for CloudFront)
        acm = get_acm_client()
        
        # List certificates
        response = acm.list_certificates(
            CertificateStatuses=['ISSUED'],
            MaxItems=100
        )
        
        certificate_summaries = response.get('CertificateSummaryList', [])
        
        # Get detailed information for each certificate using ThreadPoolExecutor
        # to parallelize the API calls
        certificate_details = []
        
        with ThreadPoolExecutor(max_workers=10) as executor:
            # Submit all certificate detail requests
            future_to_cert = {
                executor.submit(get_certificate_details, acm, cert['CertificateArn']): cert
                for cert in certificate_summaries
            }
            
            # Collect results
            for future in future_to_cert:
                try:
                    cert_detail = future.result(timeout=30)  # 30 second timeout per request
                    certificate_details.append(cert_detail)
                except Exception as error:
                    cert = future_to_cert[future]
                    logger.warning(f"Failed to get details for certificate {cert['CertificateArn']}: {error}")
                    certificate_details.append({
                        'arn': cert['CertificateArn'],
                        'domainName': cert.get('DomainName'),
                        'status': cert.get('Status'),
                        'error': 'Failed to load certificate details'
                    })
        
        logger.info(f"Found {len(certificate_details)} certificates")
        
        return cors_response(200, {
            'success': True,
            'data': {
                'certificates': certificate_details,
                'count': len(certificate_details)
            }
        })
        
    except ClientError as aws_error:
        error_code = aws_error.response.get('Error', {}).get('Code', 'Unknown')
        error_message = aws_error.response.get('Error', {}).get('Message', str(aws_error))
        
        logger.error(f'AWS error listing certificates: {error_code} - {error_message}')
        
        return cors_response(500, {
            'success': False,
            'error': error_message,
            'details': {
                'errorCode': error_code,
                'errorName': type(aws_error).__name__
            }
        })
        
    except Exception as error:
        logger.error(f'Error listing certificates: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
