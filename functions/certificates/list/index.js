const { ACMClient, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');

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
 * Lists available SSL certificates from ACM
 */
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const command = new ListCertificatesCommand({
      CertificateStatuses: ['ISSUED'],
      MaxItems: 100
    });
    
    const response = await acmClient.send(command);
    
    // Get detailed information for each certificate
    const certificateDetails = await Promise.all(
      response.CertificateSummaryList.map(async (cert) => {
        try {
          const detailCommand = new DescribeCertificateCommand({
            CertificateArn: cert.CertificateArn
          });
          const detail = await acmClient.send(detailCommand);
          
          return {
            arn: cert.CertificateArn,
            domainName: cert.DomainName,
            subjectAlternativeNames: cert.SubjectAlternativeNames || [],
            status: cert.Status,
            type: cert.Type,
            keyAlgorithm: cert.KeyAlgorithm,
            keyUsages: cert.KeyUsages || [],
            extendedKeyUsages: cert.ExtendedKeyUsages || [],
            createdAt: detail.Certificate.CreatedAt,
            issuedAt: detail.Certificate.IssuedAt,
            notBefore: detail.Certificate.NotBefore,
            notAfter: detail.Certificate.NotAfter,
            renewalEligibility: detail.Certificate.RenewalEligibility,
            serial: detail.Certificate.Serial,
            subject: detail.Certificate.Subject,
            issuer: detail.Certificate.Issuer
          };
        } catch (error) {
          console.warn(`Failed to get details for certificate ${cert.CertificateArn}:`, error.message);
          return {
            arn: cert.CertificateArn,
            domainName: cert.DomainName,
            subjectAlternativeNames: cert.SubjectAlternativeNames || [],
            status: cert.Status,
            type: cert.Type,
            error: 'Failed to load certificate details'
          };
        }
      })
    );
    
    return corsResponse(200, {
      success: true,
      data: {
        certificates: certificateDetails,
        count: certificateDetails.length
      }
    });
  } catch (error) {
    console.error('Error listing certificates:', error);
    
    return corsResponse(500, {
      success: false,
      error: error.message
    });
  }
};
