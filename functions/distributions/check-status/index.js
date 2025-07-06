const { CloudFrontClient, GetDistributionCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize clients
const cloudfrontClient = new CloudFrontClient();
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Trigger Lambda@Edge replication by updating CloudFront distribution
 * This mimics what the AWS console does to force immediate replication
 */
const triggerLambdaEdgeReplication = async (distributionId, distributionRecord) => {
  try {
    console.log('Triggering Lambda@Edge replication for distribution:', distributionId);
    
    // Get current distribution configuration
    const getResult = await cloudfrontClient.send(new GetDistributionCommand({ 
      Id: distributionRecord.cloudfrontId 
    }));
    
    // Make a small update to trigger Lambda@Edge replication
    const currentConfig = getResult.Distribution.DistributionConfig;
    
    // Clean the comment and add replication marker
    let baseComment = currentConfig.Comment || '';
    baseComment = baseComment.replace(/\s*\[Replication:\s*\d+\]$/, '');
    baseComment = baseComment.replace(/\s*\[Lambda@Edge Associated:\s*\d+\]$/, '');
    
    const timestamp = Date.now();
    const updatedComment = `${baseComment} [Replication: ${timestamp}]`;
    const finalComment = updatedComment.length > 128 
      ? `${baseComment.substring(0, 100)} [R:${timestamp}]`
      : updatedComment;
    
    const updatedConfig = {
      ...currentConfig,
      Comment: finalComment
    };
    
    const updateParams = {
      Id: distributionRecord.cloudfrontId,
      DistributionConfig: updatedConfig,
      IfMatch: getResult.ETag
    };
    
    await cloudfrontClient.send(new UpdateDistributionCommand(updateParams));
    console.log(`Successfully triggered Lambda@Edge replication. Comment updated to: ${finalComment}`);
    
    return true;
  } catch (error) {
    console.error('Failed to trigger Lambda@Edge replication:', error.message);
    // Don't fail the entire process if replication trigger fails
    return false;
  }
};

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
      // Safely handle version increment to avoid NaN errors
      const currentVersion = typeof getResult.Item.version === 'number' ? getResult.Item.version : 0;
      const nextVersion = currentVersion + 1;
      
      await docClient.send(new UpdateCommand({
        TableName: process.env.DISTRIBUTIONS_TABLE,
        Key: {
          distributionId: distributionId
        },
        UpdateExpression: 'set #status = :status, updatedAt = :updatedAt, version = :version',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': currentStatus,
          ':updatedAt': new Date().toISOString(),
          ':version': nextVersion
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
          version: nextVersion,
          previousStatus: previousStatus,
          newStatus: currentStatus
        }
      }));
      
      console.log(`Updated status for ${distributionId} from ${previousStatus} to ${currentStatus}`);
      
      // NEW: Trigger Lambda@Edge replication for multi-origin distributions when they become deployed
      if (currentStatus === 'Deployed' && 
          previousStatus === 'InProgress' && 
          getResult.Item.isMultiOrigin === true && 
          getResult.Item.lambdaEdgeFunctionId) {
        
        console.log(`Multi-origin distribution ${distributionId} is now deployed. Triggering Lambda@Edge replication...`);
        await triggerLambdaEdgeReplication(distributionId, getResult.Item);
      }
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
