const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

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
    // Get origin ID from path parameters
    const originId = event.pathParameters.id;
    
    if (!originId) {
      return corsResponse(400, {
        message: 'Origin ID is required'
      });
    }
    
    // Get origin from DynamoDB
    const params = {
      TableName: process.env.ORIGINS_TABLE,
      Key: {
        originId: originId
      }
    };
    
    const result = await docClient.send(new GetCommand(params));
    
    if (!result.Item) {
      return corsResponse(404, {
        message: `Origin with ID ${originId} not found`
      });
    }
    
    // Format response
    const origin = {
      id: result.Item.originId,
      name: result.Item.name,
      bucketName: result.Item.bucketName,
      region: result.Item.region,
      isWebsiteEnabled: result.Item.isWebsiteEnabled || false,
      websiteConfiguration: result.Item.websiteConfiguration || null,
      corsConfiguration: result.Item.corsConfiguration || null,
      createdBy: result.Item.createdBy,
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt
    };
    
    return corsResponse(200, {
      success: true,
      data: {
        origin: {
          id: result.Item.originId,
          name: result.Item.name,
          bucketName: result.Item.bucketName,
          region: result.Item.region,
          isWebsiteEnabled: result.Item.isWebsiteEnabled || false,
          websiteConfiguration: result.Item.websiteConfiguration || null,
          corsConfiguration: result.Item.corsConfiguration || null,
          createdBy: result.Item.createdBy,
          createdAt: result.Item.createdAt,
          updatedAt: result.Item.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Error getting origin:', error);
    return corsResponse(500, {
      message: 'Error getting origin',
      error: error.message
    });
  }
};
