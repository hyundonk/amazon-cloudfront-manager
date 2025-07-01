const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { v4: uuidv4 } = require('uuid');

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE;

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
 * Creates a new CloudFront distribution template
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }
    
    try {
        const body = JSON.parse(event.body);
        
        if (!body.name || !body.config) {
            return corsResponse(400, {
                success: false,
                error: "Missing required fields: name and config"
            });
        }
        
        const timestamp = new Date().toISOString();
        const templateId = `tmpl-${uuidv4().substring(0, 8)}`;
        
        // Process SSL certificate configuration if provided
        let processedConfig = body.config;
        
        if (body.certificateArn && body.customDomains) {
            const domains = body.customDomains.split(',').map(d => d.trim()).filter(d => d);
            
            processedConfig = {
                ...body.config,
                ViewerCertificate: {
                    AcmCertificateArn: body.certificateArn,
                    SslSupportMethod: "sni-only",
                    MinimumProtocolVersion: body.minTlsVersion || "TLSv1.2_2021",
                    CertificateSource: "acm"
                },
                Aliases: {
                    Quantity: domains.length,
                    Items: domains
                },
                DefaultCacheBehavior: {
                    ...body.config.DefaultCacheBehavior,
                    ViewerProtocolPolicy: body.viewerProtocol || "redirect-to-https"
                }
            };
        } else if (body.config.DefaultCacheBehavior) {
            // Ensure default certificate configuration
            processedConfig = {
                ...body.config,
                ViewerCertificate: {
                    CloudFrontDefaultCertificate: true,
                    MinimumProtocolVersion: body.minTlsVersion || "TLSv1.2_2021"
                }
            };
        }

        const template = {
            templateId,
            name: body.name,
            description: body.description || '',
            category: body.category || 'General',
            createdBy: body.createdBy || 'system',
            createdAt: timestamp,
            updatedAt: timestamp,
            config: processedConfig,
            features: body.features || [],
            // Store SSL configuration metadata
            sslConfig: {
                certificateArn: body.certificateArn || null,
                customDomains: body.customDomains || null,
                viewerProtocol: body.viewerProtocol || 'allow-all',
                minTlsVersion: body.minTlsVersion || 'TLSv1.2_2021'
            }
        };
        
        const params = {
            TableName: TEMPLATES_TABLE,
            Item: template
        };
        
        await docClient.send(new PutCommand(params));
        
        return corsResponse(201, {
            success: true,
            data: {
                template
            }
        });
    } catch (error) {
        console.error('Error:', error);
        
        return corsResponse(500, {
            success: false,
            error: error.message
        });
    }
};
