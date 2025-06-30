const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

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

// Initialize clients
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    // Get query parameters
    const queryParams = event.queryStringParameters || {};
    const limit = queryParams.limit ? parseInt(queryParams.limit) : 50;
    const nextToken = queryParams.nextToken;
    
    // Scan DynamoDB for origins
    const params = {
      TableName: process.env.ORIGINS_TABLE,
      Limit: limit
    };
    
    if (nextToken) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    }
    
    const result = await docClient.send(new ScanCommand(params));
    
    // Format response
    const origins = result.Items.map(item => ({
      id: item.originId,
      name: item.name,
      bucketName: item.bucketName,
      region: item.region,
      isWebsiteEnabled: item.isWebsiteEnabled || false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
    
    // Generate next token if there are more results
    let responseData = {
      origins,
      count: origins.length,
      total: result.Count
    };
    
    if (result.LastEvaluatedKey) {
      responseData.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }
    
    return corsResponse(200, {
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error listing origins:', error);
    return corsResponse(500, {
      message: 'Error listing origins',
      error: error.message
    });
  }
};
