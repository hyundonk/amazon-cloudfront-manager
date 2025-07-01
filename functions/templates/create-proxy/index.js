/**
 * This is a proxy Lambda function that handles CORS properly
 * and forwards requests to the actual create template function
 */
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

// Initialize client
const lambdaClient = new LambdaClient();

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,POST,DELETE',
  'Access-Control-Allow-Credentials': 'true',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }
  
  try {
    // Call the actual create template function
    const result = await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.TARGET_FUNCTION_NAME || 'CfManagerBackendStack-CreateTemplateFunction',
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(event))
    }));
    
    // Parse the response from the target function
    const payload = JSON.parse(Buffer.from(result.Payload).toString());
    
    // Return the response with CORS headers
    return {
      statusCode: payload.statusCode,
      headers: {
        ...CORS_HEADERS,
        ...(payload.headers || {})
      },
      body: payload.body
    };
  } catch (error) {
    console.error('Error invoking target function:', error);
    
    // Return error response with CORS headers
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Error creating template',
        error: error.message
      })
    };
  }
};
