const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFrontClient, DeleteDistributionCommand, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { S3Client, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

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
const s3Client = new S3Client();

// Helper function to remove distribution ARN from origin OAC policy
async function removeDistributionFromOriginOAC(distributionConfig, distributionArn) {
  // Check if this distribution uses S3 origins
  const s3Origins = distributionConfig.Origins.Items.filter(origin => 
    origin.DomainName && origin.DomainName.includes('s3.amazonaws.com')
  );
  
  if (s3Origins.length === 0) {
    console.log('No S3 origins found, skipping OAC policy update');
    return;
  }
  
  for (const origin of s3Origins) {
    try {
      // Extract bucket name from domain name
      const bucketName = origin.DomainName.split('.')[0];
      
      // Find the origin record in DynamoDB
      const scanResult = await docClient.send(new ScanCommand({
        TableName: process.env.ORIGINS_TABLE,
        FilterExpression: 'bucketName = :bucketName',
        ExpressionAttributeValues: {
          ':bucketName': bucketName
        }
      }));
      
      if (scanResult.Items && scanResult.Items.length > 0) {
        const originRecord = scanResult.Items[0];
        
        // Remove this distribution ARN from the list
        const updatedDistributionArns = (originRecord.distributionArns || [])
          .filter(arn => arn !== distributionArn);
        
        await docClient.send(new UpdateCommand({
          TableName: process.env.ORIGINS_TABLE,
          Key: {
            originId: originRecord.originId
          },
          UpdateExpression: 'set distributionArns = :arns, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':arns': updatedDistributionArns,
            ':updatedAt': new Date().toISOString()
          }
        }));
        
        // Update S3 bucket policy to remove the distribution ARN
        if (updatedDistributionArns.length > 0) {
          const bucketPolicy = {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'AllowCloudFrontServicePrincipal',
                Effect: 'Allow',
                Principal: {
                  Service: 'cloudfront.amazonaws.com'
                },
                Action: 's3:GetObject',
                Resource: `arn:aws:s3:::${bucketName}/*`,
                Condition: {
                  StringEquals: {
                    'AWS:SourceArn': updatedDistributionArns
                  }
                }
              }
            ]
          };
          
          // If website is enabled, also allow public access
          if (originRecord.isWebsiteEnabled) {
            bucketPolicy.Statement.push({
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${bucketName}/*`
            });
          }
          
          await s3Client.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(bucketPolicy)
          }));
        } else {
          // If no distributions left, create a minimal policy
          const bucketPolicy = {
            Version: '2012-10-17',
            Statement: []
          };
          
          // If website is enabled, keep public access
          if (originRecord.isWebsiteEnabled) {
            bucketPolicy.Statement.push({
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${bucketName}/*`
            });
          }
          
          await s3Client.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(bucketPolicy)
          }));
        }
        
        console.log(`Updated OAC policy for bucket ${bucketName}, removed distribution ${distributionArn}`);
      }
    } catch (error) {
      console.error(`Error updating OAC policy for origin ${origin.Id}:`, error);
      // Don't fail the deletion if OAC update fails
      console.log('Continuing with distribution deletion...');
    }
  }
}

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
    
    const cloudfrontId = result.Item.cloudfrontId;
    
    if (cloudfrontId) {
      try {
        // Get the distribution config to get the ETag
        const configResult = await cloudfrontClient.send(new GetDistributionConfigCommand({
          Id: cloudfrontId
        }));
        
        const config = configResult.DistributionConfig;
        const distributionArn = result.Item.arn;
        
        // Update origin OAC policies to remove this distribution
        if (distributionArn) {
          try {
            await removeDistributionFromOriginOAC(config, distributionArn);
          } catch (oacError) {
            console.error('Error updating origin OAC policy:', oacError);
            // Continue with distribution deletion even if OAC update fails
          }
        }
        
        // Disable the distribution first
        config.Enabled = false;
        
        // Update the distribution to disable it
        await cloudfrontClient.send(new UpdateDistributionCommand({
          Id: cloudfrontId,
          IfMatch: configResult.ETag,
          DistributionConfig: config
        }));
        
        // Wait for the distribution to be deployed with the disabled state
        // In a real implementation, you would use a Step Function to wait and check status
        
        // Delete the distribution
        await cloudfrontClient.send(new DeleteDistributionCommand({
          Id: cloudfrontId,
          IfMatch: configResult.ETag
        }));
      } catch (cfError) {
        console.error('CloudFront error:', cfError);
        // Continue with deleting the record even if CloudFront deletion fails
      }
    }
    
    // Delete the record from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: process.env.DISTRIBUTIONS_TABLE,
      Key: {
        distributionId: distributionId
      }
    }));
    
    return corsResponse(200, {
      message: `Distribution ${distributionId} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting distribution:', error);
    return corsResponse(500, {
      message: 'Error deleting distribution',
      error: error.message
    });
  }
};
