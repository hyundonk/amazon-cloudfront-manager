const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

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
 * Lists all CloudFront distribution templates
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }
    
    try {
        const params = {
            TableName: TEMPLATES_TABLE
        };
        
        const { Items: templates } = await docClient.send(new ScanCommand(params));
        
        // Transform the templates to match the expected format in the frontend
        const transformedTemplates = templates.map(template => ({
            id: template.templateId,  // Map templateId to id for frontend compatibility
            name: template.name,
            category: template.category,
            description: template.description,
            features: template.config?.features || [],
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
            createdBy: template.createdBy,
            config: template.config
        }));
        
        return corsResponse(200, {
            success: true,
            data: {
                templates: transformedTemplates || []
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
