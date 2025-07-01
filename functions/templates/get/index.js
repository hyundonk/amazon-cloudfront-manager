const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");

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
 * Gets a CloudFront distribution template by ID
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
        
        const params = {
            TableName: TEMPLATES_TABLE,
            Key: { templateId }
        };
        
        const { Item: template } = await docClient.send(new GetCommand(params));
        
        if (!template) {
            return corsResponse(404, {
                success: false,
                error: "Template not found"
            });
        }
        
        // Transform the template to match the expected format in the frontend
        const transformedTemplate = {
            id: template.templateId,  // Map templateId to id for frontend compatibility
            name: template.name,
            category: template.category,
            description: template.description,
            features: template.config?.features || [],
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
            createdBy: template.createdBy,
            config: template.config
        };
        
        return corsResponse(200, {
            success: true,
            data: {
                template: transformedTemplate
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
