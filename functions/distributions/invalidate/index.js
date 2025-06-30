const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { v4: uuidv4 } = require('uuid');
const { corsResponse, handleCorsPreflightRequest } = require('./cors');

// Initialize clients
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudfrontClient = new CloudFrontClient();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const distributionId = event.pathParameters.id;
    const body = JSON.parse(event.body);
    
    // Validate input
    if (!distributionId) {
      return corsResponse(400, {
        message: 'Distribution ID is required'
      });
    }
    
    if (!body.paths || !Array.isArray(body.paths) || body.paths.length === 0) {
      return corsResponse(400, {
        message: 'At least one path is required for invalidation'
      });
    }
    
    // Check if distribution exists
    const distributionResult = await docClient.send(new GetCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      }
    }));
    
    if (!distributionResult.Item) {
      return corsResponse(404, {
        message: `Distribution ${distributionId} not found`
      });
    }
    
    // Create invalidation
    const callerReference = body.callerReference || uuidv4();
    
    const invalidationParams = {
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: callerReference,
        Paths: {
          Quantity: body.paths.length,
          Items: body.paths
        }
      }
    };
    
    const result = await cloudfrontClient.send(new CreateInvalidationCommand(invalidationParams));
    
    // Get user info from Cognito claims
    const user = event.requestContext?.authorizer?.claims?.email || 'unknown';
    
    // Record invalidation in history table
    const timestamp = new Date().toISOString();
    await docClient.send(new PutCommand({
      TableName: process.env.HISTORY_TABLE,
      Item: {
        distributionId: distributionId,
        timestamp: timestamp,
        action: 'INVALIDATION',
        user: user,
        invalidationId: result.Invalidation.Id,
        paths: body.paths
      }
    }));
    
    return corsResponse(201, {
      invalidationId: result.Invalidation.Id,
      status: result.Invalidation.Status,
      createTime: result.Invalidation.CreateTime,
      paths: body.paths
    });
  } catch (error) {
    console.error('Error creating invalidation:', error);
    return corsResponse(500, {
      message: 'Error creating invalidation',
      error: error.message
    });
  }
};
