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
        const params = {
            TableName: process.env.LAMBDA_EDGE_FUNCTIONS_TABLE
        };

        const result = await dynamodb.scan(params).promise();

        const functions = result.Items.map(item => ({
            functionId: item.functionId,
            functionName: item.functionName,
            functionArn: item.functionArn,
            preset: item.preset,
            status: item.status,
            createdBy: item.createdBy,
            createdAt: item.createdAt,
            originsCount: 1 + (item.origins.additional ? item.origins.additional.length : 0)
        }));

        return corsResponse(200, {
            success: true,
            data: {
                functions,
                count: functions.length
            }
        });

    } catch (error) {
        console.error('Error listing Lambda@Edge functions:', error);
        return corsResponse(500, {
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};
