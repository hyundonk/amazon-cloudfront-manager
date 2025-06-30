const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutBucketWebsiteCommand, DeleteBucketWebsiteCommand, PutBucketCorsCommand, PutBucketPolicyCommand, DeleteBucketPolicyCommand } = require('@aws-sdk/client-s3');

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
const s3Client = new S3Client();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const originId = event.pathParameters.id;
    const body = JSON.parse(event.body);
    
    // Validate input
    if (!originId) {
      return corsResponse(400, {
        message: 'Origin ID is required'
      });
    }
    
    // Get the existing origin
    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.ORIGINS_TABLE,
      Key: {
        originId: originId
      }
    }));
    
    if (!getResult.Item) {
      return corsResponse(404, {
        message: `Origin with ID ${originId} not found`
      });
    }
    
    const existingOrigin = getResult.Item;
    const bucketName = existingOrigin.bucketName;
    
    // Update S3 bucket configuration
    try {
      // Update website configuration
      if (body.isWebsiteEnabled !== undefined) {
        if (body.isWebsiteEnabled) {
          // Enable website hosting
          const websiteConfig = body.websiteConfiguration || {
            IndexDocument: {
              Suffix: 'index.html'
            },
            ErrorDocument: {
              Key: 'error.html'
            }
          };
          
          await s3Client.send(new PutBucketWebsiteCommand({
            Bucket: bucketName,
            WebsiteConfiguration: websiteConfig
          }));
          
          console.log(`Website configuration enabled for bucket ${bucketName}`);
          
          // Set bucket policy to allow public access if website is enabled
          const bucketPolicy = {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PublicReadGetObject',
                Effect: 'Allow',
                Principal: '*',
                Action: 's3:GetObject',
                Resource: `arn:aws:s3:::${bucketName}/*`
              }
            ]
          };
          
          await s3Client.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(bucketPolicy)
          }));
          
          console.log(`Public read policy set for bucket ${bucketName}`);
        } else {
          // Disable website hosting
          await s3Client.send(new DeleteBucketWebsiteCommand({
            Bucket: bucketName
          }));
          
          console.log(`Website configuration disabled for bucket ${bucketName}`);
          
          // Remove public access policy
          try {
            await s3Client.send(new DeleteBucketPolicyCommand({
              Bucket: bucketName
            }));
            
            console.log(`Public read policy removed for bucket ${bucketName}`);
          } catch (policyError) {
            console.error('Error removing bucket policy:', policyError);
            // Continue even if policy removal fails
          }
        }
      }
      
      // Update CORS configuration
      if (body.corsConfiguration) {
        await s3Client.send(new PutBucketCorsCommand({
          Bucket: bucketName,
          CORSConfiguration: body.corsConfiguration
        }));
        
        console.log(`CORS configuration updated for bucket ${bucketName}`);
      }
    } catch (s3Error) {
      console.error('Error updating S3 bucket configuration:', s3Error);
      return corsResponse(500, {
        message: 'Error updating S3 bucket configuration',
        error: s3Error.message
      });
    }
    
    // Get user info from Cognito claims
    const user = event.requestContext?.authorizer?.claims?.email || 'unknown';
    
    // Update origin in DynamoDB
    const timestamp = new Date().toISOString();
    
    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    if (body.name) {
      updateExpression.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = body.name;
    }
    
    if (body.isWebsiteEnabled !== undefined) {
      updateExpression.push('#isWebsiteEnabled = :isWebsiteEnabled');
      expressionAttributeNames['#isWebsiteEnabled'] = 'isWebsiteEnabled';
      expressionAttributeValues[':isWebsiteEnabled'] = body.isWebsiteEnabled;
    }
    
    if (body.websiteConfiguration) {
      updateExpression.push('#websiteConfiguration = :websiteConfiguration');
      expressionAttributeNames['#websiteConfiguration'] = 'websiteConfiguration';
      expressionAttributeValues[':websiteConfiguration'] = body.websiteConfiguration;
    }
    
    if (body.corsConfiguration) {
      updateExpression.push('#corsConfiguration = :corsConfiguration');
      expressionAttributeNames['#corsConfiguration'] = 'corsConfiguration';
      expressionAttributeValues[':corsConfiguration'] = body.corsConfiguration;
    }
    
    // Always update updatedAt and updatedBy
    updateExpression.push('#updatedAt = :updatedAt');
    updateExpression.push('#updatedBy = :updatedBy');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeNames['#updatedBy'] = 'updatedBy';
    expressionAttributeValues[':updatedAt'] = timestamp;
    expressionAttributeValues[':updatedBy'] = user;
    
    await docClient.send(new UpdateCommand({
      TableName: process.env.ORIGINS_TABLE,
      Key: {
        originId: originId
      },
      UpdateExpression: 'SET ' + updateExpression.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));
    
    return corsResponse(200, {
      id: originId,
      name: body.name || existingOrigin.name,
      bucketName: bucketName,
      region: existingOrigin.region,
      isWebsiteEnabled: body.isWebsiteEnabled !== undefined ? body.isWebsiteEnabled : existingOrigin.isWebsiteEnabled,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('Error updating origin:', error);
    return corsResponse(500, {
      message: 'Error updating origin',
      error: error.message
    });
  }
};
