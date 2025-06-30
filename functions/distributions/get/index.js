const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');

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
const cloudfrontClient = new CloudFrontClient();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const distributionId = event.pathParameters.id;
    
    if (!distributionId) {
      return corsResponse(400, {
        message: 'Distribution ID is required'
      });
    }
    
    // Get distribution from DynamoDB
    const result = await docClient.send(new GetCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      }
    }));
    
    if (!result.Item) {
      return corsResponse(404, {
        message: `Distribution ${distributionId} not found`
      });
    }
    
    // Get the latest status from CloudFront
    try {
      const cfResult = await cloudfrontClient.send(new GetDistributionCommand({
        Id: result.Item.cloudfrontId // Use the actual CloudFront ID, not our internal ID
      }));
      
      // Update status if it has changed
      if (cfResult.Distribution.Status !== result.Item.status) {
        await docClient.send(new UpdateCommand({
          TableName: process.env.DISTRIBUTIONS_TABLE,
          Key: {
            distributionId: distributionId
          },
          UpdateExpression: 'set #status = :status, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#status': 'status'
          },
          ExpressionAttributeValues: {
            ':status': cfResult.Distribution.Status,
            ':updatedAt': new Date().toISOString()
          }
        }));
        
        result.Item.status = cfResult.Distribution.Status;
      }
    } catch (cfError) {
      console.warn(`Could not get latest status from CloudFront: ${cfError.message}`);
      // Continue with the stored status
    }
    
    // Get distribution history
    const historyResult = await docClient.send(new QueryCommand({
      TableName: process.env.HISTORY_TABLE,
      KeyConditionExpression: 'distributionId = :distributionId',
      ExpressionAttributeValues: {
        ':distributionId': distributionId
      },
      Limit: 10,
      ScanIndexForward: false // Get most recent first
    }));
    
    return corsResponse(200, {
      success: true,
      data: {
        distribution: {
          id: result.Item.distributionId,
          cloudfrontId: result.Item.cloudfrontId,
          name: result.Item.name,
          status: result.Item.status,
          domainName: result.Item.domainName,
          arn: result.Item.arn,
          config: result.Item.config,
          tags: result.Item.tags || {},
          createdBy: result.Item.createdBy,
          createdAt: result.Item.createdAt,
          updatedBy: result.Item.updatedBy,
          updatedAt: result.Item.updatedAt,
          version: result.Item.version
        },
        history: historyResult.Items.map(item => ({
          timestamp: item.timestamp,
          action: item.action,
          user: item.user,
          version: item.version
        }))
      }
    });
  } catch (error) {
    console.error('Error getting distribution:', error);
    return corsResponse(500, {
      message: 'Error getting distribution',
      error: error.message
    });
  }
};
