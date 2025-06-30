const { ACMClient, DescribeCertificateCommand } = require('@aws-sdk/client-acm');

const acmClient = new ACMClient({ region: 'us-east-1' });

// CORS headers
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

// Helper function to generate CORS response
function corsResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

// Helper function to handle OPTIONS requests for CORS preflight
function handleCorsPreflightRequest() {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: ''
  };
}

/**
 * Gets detailed information about a specific SSL certificate
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const certificateArn = decodeURIComponent(event.pathParameters?.arn || '');
    
    if (!certificateArn) {
      return corsResponse(400, {
        success: false,
        message: 'Certificate ARN is required'
      });
    }
    
    const command = new DescribeCertificateCommand({
      CertificateArn: certificateArn
    });
    
    const response = await acmClient.send(command);
    const cert = response.Certificate;
    
    const certificateDetails = {
      arn: cert.CertificateArn,
      domainName: cert.DomainName,
      subjectAlternativeNames: cert.SubjectAlternativeNames || [],
      status: cert.Status,
      type: cert.Type,
      keyAlgorithm: cert.KeyAlgorithm,
      keyUsages: cert.KeyUsages || [],
      extendedKeyUsages: cert.ExtendedKeyUsages || [],
      createdAt: cert.CreatedAt,
      issuedAt: cert.IssuedAt,
      notBefore: cert.NotBefore,
      notAfter: cert.NotAfter,
      renewalEligibility: cert.RenewalEligibility,
      serial: cert.Serial,
      subject: cert.Subject,
      issuer: cert.Issuer,
      domainValidationOptions: cert.DomainValidationOptions || [],
      inUseBy: cert.InUseBy || [],
      failureReason: cert.FailureReason,
      options: cert.Options
    };
    
    // Calculate days until expiration
    if (cert.NotAfter) {
      const expirationDate = new Date(cert.NotAfter);
      const now = new Date();
      const daysUntilExpiration = Math.ceil((expirationDate - now) / (1000 * 60 * 60 * 24));
      certificateDetails.daysUntilExpiration = daysUntilExpiration;
      certificateDetails.isExpiringSoon = daysUntilExpiration < 30;
    }
    
    return corsResponse(200, {
      success: true,
      data: {
        certificate: certificateDetails
      }
    });
  } catch (error) {
    console.error('Error getting certificate details:', error);
    
    if (error.name === 'ResourceNotFoundException') {
      return corsResponse(404, {
        success: false,
        message: 'Certificate not found'
      });
    }
    
    return corsResponse(500, {
      success: false,
      error: error.message
    });
  }
};
