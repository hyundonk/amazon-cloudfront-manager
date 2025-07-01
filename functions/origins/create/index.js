const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, CreateBucketCommand, PutBucketWebsiteCommand, PutBucketCorsCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateOriginAccessControlCommand } = require('@aws-sdk/client-cloudfront');
const { v4: uuidv4 } = require('uuid');

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
    const body = JSON.parse(event.body);
    
    // Validate input
    if (!body.name) {
      return corsResponse(400, {
        message: 'Origin name is required'
      });
    }
    
    if (!body.bucketName) {
      return corsResponse(400, {
        message: 'Bucket name is required'
      });
    }
    
    // Generate a unique ID for the origin
    const originId = 'origin-' + uuidv4().substring(0, 8);
    
    // Get user info from Cognito claims
    const user = event.requestContext?.authorizer?.claims?.email || 'unknown';
    
    // Create S3 bucket
    const region = body.region || process.env.AWS_REGION || 'us-east-1';
    let oacId = null; // Declare oacId at function scope
    
    // Create region-specific S3 client for cross-region bucket creation
    const s3Client = new S3Client({ region: region });
    
    try {
      const createBucketParams = {
        Bucket: body.bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: region !== 'us-east-1' ? region : undefined
        }
      };
      
      await s3Client.send(new CreateBucketCommand(createBucketParams));
      console.log(`Bucket ${body.bucketName} created successfully`);
      
      // Configure website hosting if enabled
      if (body.isWebsiteEnabled) {
        const websiteConfig = body.websiteConfiguration || {
          IndexDocument: {
            Suffix: 'index.html'
          },
          ErrorDocument: {
            Key: 'error.html'
          }
        };
        
        await s3Client.send(new PutBucketWebsiteCommand({
          Bucket: body.bucketName,
          WebsiteConfiguration: websiteConfig
        }));
        
        console.log(`Website configuration enabled for bucket ${body.bucketName}`);
        
        // Set bucket policy to allow public access if website is enabled
        const bucketPolicy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicReadGetObject',
              Effect: 'Allow',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${body.bucketName}/*`
            }
          ]
        };
        
        await s3Client.send(new PutBucketPolicyCommand({
          Bucket: body.bucketName,
          Policy: JSON.stringify(bucketPolicy)
        }));
        
        console.log(`Public read policy set for bucket ${body.bucketName}`);
      }
      
      // Configure CORS if provided
      if (body.corsConfiguration) {
        await s3Client.send(new PutBucketCorsCommand({
          Bucket: body.bucketName,
          CORSConfiguration: body.corsConfiguration
        }));
        
        console.log(`CORS configuration set for bucket ${body.bucketName}`);
      }
      
      // Create Origin Access Control (OAC) for this S3 bucket
      try {
        const oacName = `OAC-${body.bucketName}-${Date.now()}`;
        const createOACCommand = new CreateOriginAccessControlCommand({
          OriginAccessControlConfig: {
            Name: oacName,
            Description: `Origin Access Control for S3 bucket ${body.bucketName}`,
            OriginAccessControlOriginType: 's3', // Fixed: lowercase 's3' instead of 'S3'
            SigningBehavior: 'always',
            SigningProtocol: 'sigv4'
          }
        });
        
        const oacResult = await cloudfrontClient.send(createOACCommand);
        oacId = oacResult.OriginAccessControl.Id;
        
        console.log(`OAC created successfully: ${oacId} for bucket ${body.bucketName}`);
        
        // Update S3 bucket policy to allow CloudFront access via OAC
        const cloudFrontPolicy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowCloudFrontServicePrincipal',
              Effect: 'Allow',
              Principal: {
                Service: 'cloudfront.amazonaws.com'
              },
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${body.bucketName}/*`,
              Condition: {
                StringEquals: {
                  'AWS:SourceArn': [] // Will be populated when distributions are created
                }
              }
            }
          ]
        };
        
        // If website is enabled, also allow public access
        if (body.isWebsiteEnabled) {
          cloudFrontPolicy.Statement.push({
            Sid: 'PublicReadGetObject',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${body.bucketName}/*`
          });
        }
        
        await s3Client.send(new PutBucketPolicyCommand({
          Bucket: body.bucketName,
          Policy: JSON.stringify(cloudFrontPolicy)
        }));
        
        console.log(`CloudFront OAC policy set for bucket ${body.bucketName}`);
        
      } catch (oacError) {
        console.error('Error creating OAC:', oacError);
        // Don't fail the entire operation if OAC creation fails
        console.log('Continuing without OAC...');
        oacId = null; // Explicitly set to null when OAC creation fails
      }
      
    } catch (s3Error) {
      console.error('Error creating S3 bucket:', s3Error);
      return corsResponse(500, {
        message: 'Error creating S3 bucket',
        error: s3Error.message
      });
    }
    
    // Store origin in DynamoDB
    const timestamp = new Date().toISOString();
    const item = {
      originId: originId,
      name: body.name,
      bucketName: body.bucketName,
      region: region,
      oacId: oacId, // Store the OAC ID
      distributionArns: [], // Track distributions using this origin
      isWebsiteEnabled: body.isWebsiteEnabled || false,
      websiteConfiguration: body.websiteConfiguration || null,
      corsConfiguration: body.corsConfiguration || null,
      createdBy: user,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    await docClient.send(new PutCommand({
      TableName: process.env.ORIGINS_TABLE,
      Item: item
    }));
    
    return corsResponse(201, {
      id: originId,
      name: body.name,
      bucketName: body.bucketName,
      region: region,
      oacId: oacId,
      isWebsiteEnabled: body.isWebsiteEnabled || false,
      createdAt: timestamp
    });
  } catch (error) {
    console.error('Error creating origin:', error);
    return corsResponse(500, {
      message: 'Error creating origin',
      error: error.message
    });
  }
};
