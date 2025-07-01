const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

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
 * Deletes a CloudFront distribution template
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
        
        const { Item: template } = await docClient.send(new GetCommand(getParams));
        
        if (!template) {
            return corsResponse(404, {
                success: false,
                error: "Template not found"
            });
        }
        
        const deleteParams = {
            TableName: TEMPLATES_TABLE,
            Key: { templateId }
        };
        
        await docClient.send(new DeleteCommand(deleteParams));
        
        return corsResponse(200, {
            success: true,
            message: `Template ${templateId} deleted successfully`
        });
    } catch (error) {
        console.error('Error:', error);
        
        return corsResponse(500, {
            success: false,
            error: error.message
        });
    }
};
