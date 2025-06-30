// Using AWS SDK v3 modules
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize clients
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Get distribution ID and status from event
    const distributionId = event.distributionId;
    const cloudfrontId = event.cloudfrontId;
    const status = event.status;
    const domainName = event.domainName;
    const error = event.error;
    
    if (!distributionId || !status) {
      throw new Error('Missing required parameters: distributionId and status');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update the DynamoDB record with the new status
    const updateParams = {
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      },
      UpdateExpression: 'set #s = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#s': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': timestamp
      },
      ReturnValues: 'UPDATED_NEW'
    };
    
    // Add domain name if available
    if (domainName) {
      updateParams.UpdateExpression += ', domainName = :domainName';
      updateParams.ExpressionAttributeValues[':domainName'] = domainName;
    }
    
    // Add error message if available
    if (error) {
      updateParams.UpdateExpression += ', errorMessage = :error';
      updateParams.ExpressionAttributeValues[':error'] = error;
    }
    
    const updateResult = await docClient.send(new UpdateCommand(updateParams));
    
    console.log('DynamoDB update result:', JSON.stringify(updateResult, null, 2));
    
    // Record history
    await docClient.send(new PutCommand({
      TableName: process.env.HISTORY_TABLE,
      Item: {
        distributionId: distributionId,
        timestamp: timestamp,
        action: `STATUS_${status.toUpperCase()}`,
        cloudfrontId: cloudfrontId,
        error: error
      }
    }));
    
    console.log('History record created in DynamoDB');
    
    // Return success
    return {
      distributionId: distributionId,
      cloudfrontId: cloudfrontId,
      status: status,
      domainName: domainName,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error updating distribution status:', error);
    throw error;
  }
};
