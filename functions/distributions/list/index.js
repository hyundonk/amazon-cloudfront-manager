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
    // Check if environment variables are set
    if (!process.env.DISTRIBUTIONS_TABLE) {
      console.error('DISTRIBUTIONS_TABLE environment variable is not set');
      return corsResponse(500, {
        success: false,
        message: 'Server configuration error: DISTRIBUTIONS_TABLE not configured'
      });
    }
    
    console.log('Using DISTRIBUTIONS_TABLE:', process.env.DISTRIBUTIONS_TABLE);
    
    // Get all distributions from DynamoDB
    const result = await docClient.send(new ScanCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE
    }));
    
    console.log('DynamoDB scan result:', JSON.stringify(result, null, 2));
    
    // Map the results to a simpler format
    const distributions = (result.Items || []).map(item => ({
      id: item.distributionId,
      cloudfrontId: item.cloudfrontId,
      name: item.name,
      status: item.status,
      domainName: item.domainName,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdBy: item.createdBy
    }));
    
    console.log(`Found ${distributions.length} distributions`);
    
    return corsResponse(200, {
      success: true,
      data: {
        distributions
      }
    });
  } catch (error) {
    console.error('Error listing distributions:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      statusCode: error.$metadata?.httpStatusCode
    });
    
    return corsResponse(500, {
      success: false,
      message: 'Error listing distributions',
      error: error.message,
      details: {
        errorName: error.name,
        errorCode: error.code
      }
    });
  }
};
