const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

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
 * Updates an existing CloudFront distribution template
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }
    
    try {
        const templateId = event.pathParameters?.id;
        
        if (!templateId) {
            return corsResponse(400, {
                success: false,
                error: "Missing template ID"
            });
        }
        
        // Check if template exists
        const getParams = {
            TableName: TEMPLATES_TABLE,
            Key: { templateId }
        };
        
        const { Item: existingTemplate } = await docClient.send(new GetCommand(getParams));
        
        if (!existingTemplate) {
            return corsResponse(404, {
                success: false,
                error: "Template not found"
            });
        }
        
        const body = JSON.parse(event.body);
        
        if (!body.name || !body.config) {
            return corsResponse(400, {
                success: false,
                error: "Missing required fields: name and config"
            });
        }
        
        const timestamp = new Date().toISOString();
        
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

        const updateParams = {
            TableName: TEMPLATES_TABLE,
            Key: { templateId },
            UpdateExpression: "set #name = :name, description = :description, category = :category, config = :config, features = :features, sslConfig = :sslConfig, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#name": "name"
            },
            ExpressionAttributeValues: {
                ":name": body.name,
                ":description": body.description || existingTemplate.description || '',
                ":category": body.category || existingTemplate.category || 'General',
                ":config": processedConfig,
                ":features": body.features || existingTemplate.features || [],
                ":sslConfig": {
                    certificateArn: body.certificateArn || null,
                    customDomains: body.customDomains || null,
                    viewerProtocol: body.viewerProtocol || 'allow-all',
                    minTlsVersion: body.minTlsVersion || 'TLSv1.2_2021'
                },
                ":updatedAt": timestamp
            },
            ReturnValues: "ALL_NEW"
        };
        
        const { Attributes: updatedTemplate } = await docClient.send(new UpdateCommand(updateParams));
        
        return corsResponse(200, {
            success: true,
            data: {
                template: updatedTemplate
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
