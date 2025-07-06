const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

// CORS headers
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
};

const corsResponse = (statusCode, body) => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

const handleCorsPreflightRequest = () => ({
    statusCode: 200,
    headers: CORS_HEADERS,
    body: ''
});

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }

    try {
        const functionId = event.pathParameters.id;

        const params = {
            TableName: process.env.LAMBDA_EDGE_FUNCTIONS_TABLE,
            Key: {
                functionId: functionId
            }
        };

        const result = await dynamodb.get(params).promise();

        if (!result.Item) {
            return corsResponse(404, {
                success: false,
                error: 'Lambda@Edge function not found'
            });
        }

        return corsResponse(200, {
            success: true,
            data: {
                function: result.Item
            }
        });

    } catch (error) {
        console.error('Error getting Lambda@Edge function:', error);
        return corsResponse(500, {
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};
