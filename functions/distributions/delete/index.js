const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CloudFrontClient, DeleteDistributionCommand, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { LambdaClient, DeleteFunctionCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const { S3Client, PutBucketPolicyCommand, GetBucketPolicyCommand } = require('@aws-sdk/client-s3');

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
const lambdaClient = new LambdaClient({ region: 'us-east-1' }); // Lambda@Edge functions are in us-east-1

// Helper function to delete Lambda@Edge function for multi-origin distributions
async function deleteLambdaEdgeFunction(distributionRecord) {
  if (!distributionRecord.isMultiOrigin || !distributionRecord.lambdaEdgeFunctionId) {
    console.log('Not a multi-origin distribution or no Lambda@Edge function, skipping Lambda cleanup');
    return;
  }
  
  const functionId = distributionRecord.lambdaEdgeFunctionId;
  console.log(`Deleting Lambda@Edge function: ${functionId}`);
  
  try {
    // Get the Lambda@Edge function record from DynamoDB
    const functionResult = await docClient.send(new GetCommand({
      TableName: process.env.LAMBDA_EDGE_FUNCTIONS_TABLE,
      Key: { functionId: functionId }
    }));
    
    if (!functionResult.Item) {
      console.log(`Lambda@Edge function record ${functionId} not found in database`);
      return;
    }
    
    const functionRecord = functionResult.Item;
    const lambdaFunctionName = functionRecord.functionName;
    
    console.log(`Deleting Lambda function: ${lambdaFunctionName}`);
    
    // Check if the Lambda function exists
    try {
      await lambdaClient.send(new GetFunctionCommand({
        FunctionName: lambdaFunctionName
      }));
      
      // Function exists, delete it
      await lambdaClient.send(new DeleteFunctionCommand({
        FunctionName: lambdaFunctionName
      }));
      
      console.log(`Successfully deleted Lambda function: ${lambdaFunctionName}`);
    } catch (lambdaError) {
      if (lambdaError.name === 'ResourceNotFoundException') {
        console.log(`Lambda function ${lambdaFunctionName} not found, may have been already deleted`);
      } else {
        console.error(`Error deleting Lambda function ${lambdaFunctionName}:`, lambdaError);
        // Don't throw error, continue with cleanup
      }
    }
    
    // Delete the Lambda@Edge function record from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: process.env.LAMBDA_EDGE_FUNCTIONS_TABLE,
      Key: { functionId: functionId }
    }));
    
    console.log(`Successfully deleted Lambda@Edge function record: ${functionId}`);
    
  } catch (error) {
    console.error(`Error deleting Lambda@Edge function ${functionId}:`, error);
    // Don't throw error as this shouldn't block distribution deletion
  }
}

// Helper function to remove OAI principal from S3 bucket policies for multi-origin distributions
async function removeOAIFromS3BucketPolicies(distributionRecord) {
  if (!distributionRecord.isMultiOrigin || !distributionRecord.oaiId) {
    console.log('Not a multi-origin distribution or no OAI ID, skipping OAI cleanup');
    return;
  }
  
  console.log(`Removing OAI ${distributionRecord.oaiId} from S3 bucket policies`);
  
  // Get the origins used by this distribution
  const multiOriginConfig = distributionRecord.multiOriginConfig;
  if (!multiOriginConfig) {
    console.log('No multi-origin config found, skipping OAI cleanup');
    return;
  }
  
  const allOriginIds = [
    multiOriginConfig.defaultOriginId,
    ...(multiOriginConfig.additionalOriginIds || [])
  ];
  
  // Get origin details from DynamoDB
  for (const originId of allOriginIds) {
    try {
      const originResult = await docClient.send(new GetCommand({
        TableName: process.env.ORIGINS_TABLE,
        Key: { originId: originId }
      }));
      
      if (!originResult.Item) {
        console.log(`Origin ${originId} not found in database`);
        continue;
      }
      
      const origin = originResult.Item;
      const bucketName = origin.bucketName;
      const bucketRegion = origin.region;
      
      console.log(`Removing OAI from bucket policy: ${bucketName}`);
      
      // Create regional S3 client
      const s3RegionalClient = new S3Client({ region: bucketRegion });
      
      // Get existing bucket policy
      let existingPolicy = null;
      try {
        const existingPolicyResult = await s3RegionalClient.send(new GetBucketPolicyCommand({
          Bucket: bucketName
        }));
        
        if (existingPolicyResult.Policy) {
          existingPolicy = JSON.parse(existingPolicyResult.Policy);
        }
      } catch (error) {
        if (error.name !== 'NoSuchBucketPolicy') {
          console.error(`Error reading bucket policy for ${bucketName}:`, error);
        }
        continue;
      }
      
      if (!existingPolicy || !existingPolicy.Statement) {
        console.log(`No existing policy found for bucket ${bucketName}`);
        continue;
      }
      
      // Remove the OAI principal from the policy
      const oaiPrincipalToRemove = `arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${distributionRecord.oaiId}`;
      let policyModified = false;
      
      existingPolicy.Statement = existingPolicy.Statement.map(statement => {
        if (statement.Sid === 'AllowOriginAccessIdentities' || 
            statement.Sid === 'AllowOriginAccessIdentity') {
          
          if (statement.Principal && statement.Principal.AWS) {
            let principals = Array.isArray(statement.Principal.AWS) 
              ? statement.Principal.AWS 
              : [statement.Principal.AWS];
            
            // Remove the OAI principal
            const filteredPrincipals = principals.filter(principal => 
              principal !== oaiPrincipalToRemove
            );
            
            if (filteredPrincipals.length !== principals.length) {
              policyModified = true;
              console.log(`Removed OAI principal from bucket ${bucketName}`);
            }
            
            if (filteredPrincipals.length === 0) {
              // If no OAI principals left, remove the entire statement
              return null;
            } else if (filteredPrincipals.length === 1) {
              // Single principal, use string format
              statement.Principal.AWS = filteredPrincipals[0];
            } else {
              // Multiple principals, use array format
              statement.Principal.AWS = filteredPrincipals;
            }
          }
        }
        return statement;
      }).filter(statement => statement !== null); // Remove null statements
      
      // Update the bucket policy if it was modified
      if (policyModified) {
        if (existingPolicy.Statement.length === 0) {
          // If no statements left, create minimal policy
          existingPolicy.Statement = [];
        }
        
        console.log(`Updating bucket policy for ${bucketName}:`, JSON.stringify(existingPolicy, null, 2));
        
        await s3RegionalClient.send(new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(existingPolicy)
        }));
        
        console.log(`Successfully removed OAI from bucket policy: ${bucketName}`);
      } else {
        console.log(`No OAI principal found in bucket policy: ${bucketName}`);
      }
      
    } catch (error) {
      console.error(`Error removing OAI from bucket ${originId}:`, error);
      // Continue with other origins
    }
  }
}

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
        
        // Update origin policies based on distribution type
        if (result.Item.isMultiOrigin) {
          // For multi-origin distributions, remove OAI from S3 bucket policies
          try {
            await removeOAIFromS3BucketPolicies(result.Item);
          } catch (oaiError) {
            console.error('Error removing OAI from S3 bucket policies:', oaiError);
            // Continue with distribution deletion even if OAI cleanup fails
          }
          
          // Delete the associated Lambda@Edge function
          try {
            await deleteLambdaEdgeFunction(result.Item);
          } catch (lambdaError) {
            console.error('Error deleting Lambda@Edge function:', lambdaError);
            // Continue with distribution deletion even if Lambda cleanup fails
          }
        } else {
          // For single-origin distributions, update OAC policies
          if (distributionArn) {
            try {
              await removeDistributionFromOriginOAC(config, distributionArn);
            } catch (oacError) {
              console.error('Error updating origin OAC policy:', oacError);
              // Continue with distribution deletion even if OAC update fails
            }
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
