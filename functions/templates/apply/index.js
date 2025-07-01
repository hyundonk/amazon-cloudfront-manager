const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient();

const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE;
const CREATE_DISTRIBUTION_FUNCTION = process.env.CREATE_DISTRIBUTION_FUNCTION || 'CfManagerBackendStack-CreateDistributionFunction';

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
 * Applies a CloudFront distribution template to create a new distribution
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
        
        // Get the template
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
        
        // Parse the request body
        const body = JSON.parse(event.body || '{}');
        
        if (!body.name) {
            return corsResponse(400, {
                success: false,
                error: "Missing required field: name"
            });
        }
        
        // Prepare the distribution configuration
        const distributionConfig = {
            ...template.config,
            Comment: body.name
        };
        
        // Override any specific configuration from the request
        if (body.config) {
            Object.assign(distributionConfig, body.config);
        }
        
        // Invoke the create distribution function
        const invokeParams = {
            FunctionName: CREATE_DISTRIBUTION_FUNCTION,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({
                body: JSON.stringify({
                    name: body.name,
                    config: distributionConfig,
                    templateId: template.templateId
                })
            })
        };
        
        const { Payload } = await lambdaClient.send(new InvokeCommand(invokeParams));
        const responsePayload = JSON.parse(Buffer.from(Payload).toString());
        const responseBody = JSON.parse(responsePayload.body || '{}');
        
        return {
            statusCode: responsePayload.statusCode || 200,
            headers: CORS_HEADERS,
            body: JSON.stringify(responseBody)
        };
    } catch (error) {
        console.error('Error:', error);
        
        return corsResponse(500, {
            success: false,
            error: error.message
        });
    }
};
