// Using AWS SDK v3 modules
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFrontClient, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');

// Initialize clients
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudfrontClient = new CloudFrontClient();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Get distribution ID from event
    const distributionId = event.distributionId;
    const cloudfrontId = event.cloudfrontId;
    
    if (!distributionId || !cloudfrontId) {
      throw new Error('Missing required parameters: distributionId and cloudfrontId');
    }
    
    // Get distribution record from DynamoDB
    const getItemResponse = await docClient.send(new GetCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      }
    }));
    
    const distribution = getItemResponse.Item;
    
    if (!distribution) {
      throw new Error(`Distribution ${distributionId} not found in DynamoDB`);
    }
    
    // Check CloudFront distribution status
    const getDistributionResponse = await cloudfrontClient.send(new GetDistributionCommand({
      Id: cloudfrontId
    }));
    
    const status = getDistributionResponse.Distribution.Status;
    const domainName = getDistributionResponse.Distribution.DomainName;
    
    console.log(`CloudFront distribution ${cloudfrontId} status: ${status}`);
    
    // Return the status for the state machine
    return {
      distributionId: distributionId,
      cloudfrontId: cloudfrontId,
      status: status === 'Deployed' ? 'Deployed' : 'InProgress',
      domainName: domainName
    };
    
  } catch (error) {
    console.error('Error checking deployment status:', error);
    
    // Return error status for the state machine
    return {
      distributionId: event.distributionId,
      cloudfrontId: event.cloudfrontId,
      status: 'Failed',
      error: error.message
    };
  }
};
