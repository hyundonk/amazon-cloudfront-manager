const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

// Initialize clients
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Scan DynamoDB for distributions with non-final statuses
    const result = await docClient.send(new ScanCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      FilterExpression: '#status = :inprogress OR #status = :creating',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':inprogress': 'InProgress',
        ':creating': 'Creating'
      }
    }));
    
    // Filter out items without a CloudFront ID
    const pendingDistributions = result.Items.filter(item => item.cloudfrontId);
    
    console.log(`Found ${pendingDistributions.length} pending distributions`);
    
    // Process each pending distribution
    const updatePromises = pendingDistributions.map(async (distribution) => {
      try {
        // Invoke the update status function for each distribution
        const params = {
          FunctionName: process.env.UPDATE_STATUS_FUNCTION_NAME, // Use function name instead of ARN
          InvocationType: 'Event', // Asynchronous invocation
          Payload: JSON.stringify({
            distributionId: distribution.distributionId,
            cloudfrontId: distribution.cloudfrontId
          })
        };
        
        await lambdaClient.send(new InvokeCommand(params));
        console.log(`Invoked update status function for ${distribution.distributionId}`);
        return distribution.distributionId;
      } catch (error) {
        console.error(`Error invoking update status function for ${distribution.distributionId}:`, error);
        return null;
      }
    });
    
    const processedIds = await Promise.all(updatePromises);
    const successfulIds = processedIds.filter(id => id !== null);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Processed ${successfulIds.length} pending distributions`,
        processedIds: successfulIds
      })
    };
  } catch (error) {
    console.error('Error finding pending distributions:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error finding pending distributions',
        error: error.message
      })
    };
  }
};
