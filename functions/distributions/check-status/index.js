const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize clients
const cloudfrontClient = new CloudFrontClient();
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Extract parameters from the event
  const { distributionId, cloudfrontId } = event;
  
  if (!distributionId || !cloudfrontId) {
    throw new Error('Missing required parameters: distributionId and cloudfrontId are required');
  }
  
  try {
    // Get the current distribution from DynamoDB
    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      }
    }));
    
    if (!getResult.Item) {
      throw new Error(`Distribution ${distributionId} not found in DynamoDB`);
    }
    
    // Get the current status from CloudFront
    const cfResult = await cloudfrontClient.send(new GetDistributionCommand({
      Id: cloudfrontId
    }));
    
    const currentStatus = cfResult.Distribution.Status;
    const previousStatus = getResult.Item.status;
    
    console.log(`CloudFront status for ${cloudfrontId}: ${currentStatus}, Previous status: ${previousStatus}`);
    
    // If status has changed, update DynamoDB
    if (currentStatus !== previousStatus) {
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
          ':status': currentStatus,
          ':updatedAt': new Date().toISOString()
        }
      }));
      
      // Record history
      await docClient.send(new PutCommand({
        TableName: process.env.HISTORY_TABLE,
        Item: {
          distributionId: distributionId,
          timestamp: new Date().toISOString(),
          action: 'STATUS_CHANGED',
          user: 'system',
          version: getResult.Item.version + 1,
          previousStatus: previousStatus,
          newStatus: currentStatus
        }
      }));
      
      console.log(`Updated status for ${distributionId} from ${previousStatus} to ${currentStatus}`);
    } else {
      console.log(`Status unchanged for ${distributionId}: ${currentStatus}`);
    }
    
    // Return the current status and whether it's completed
    return {
      distributionId,
      cloudfrontId,
      status: currentStatus,
      isCompleted: currentStatus === 'Deployed' || currentStatus === 'Failed'
    };
  } catch (error) {
    console.error('Error checking distribution status:', error);
    throw error;
  }
};
