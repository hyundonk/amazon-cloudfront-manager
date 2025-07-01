// Using AWS SDK v3 modules
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { 
  CloudFrontClient, 
  CreateDistributionCommand,
  CreateDistributionWithTagsCommand,
  GetDistributionCommand,
  TagResourceCommand
} = require('@aws-sdk/client-cloudfront');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const { S3Client, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');
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
const sfnClient = new SFNClient();
const s3Client = new S3Client();

// Helper function to update origin OAC policy with new distribution
async function updateOriginOACPolicy(distributionConfig, distributionArn, distributionId) {
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
        const oacId = originRecord.oacId;
        
        if (oacId) {
          // Update the origin record to include this distribution ARN
          const updatedDistributionArns = [...(originRecord.distributionArns || []), distributionArn];
          
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
          
          // Update S3 bucket policy to include the new distribution ARN
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
          
          console.log(`Updated OAC policy for bucket ${bucketName} with distribution ${distributionArn}`);
        }
      }
    } catch (error) {
      console.error(`Error updating OAC policy for origin ${origin.Id}:`, error);
      throw error;
    }
  }
}

// Default CloudFront distribution configuration
const getDefaultDistributionConfig = (name, originDomain, originPath = '') => {
  // Ensure originPath is properly formatted
  let formattedOriginPath = originPath;
  if (formattedOriginPath) {
    if (!formattedOriginPath.startsWith('/')) {
      formattedOriginPath = '/' + formattedOriginPath;
    }
    
    // If originPath is just '/', set it to empty string
    if (formattedOriginPath === '/') {
      formattedOriginPath = '';
    }
    
    // Remove trailing slash if present (unless it's the root path)
    if (formattedOriginPath.length > 1 && formattedOriginPath.endsWith('/')) {
      formattedOriginPath = formattedOriginPath.slice(0, -1);
    }
  }
  
  return {
    CallerReference: `${name}-${Date.now()}`,
    Comment: name,
    Enabled: true,
    DefaultRootObject: 'index.html',
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: 'default-origin',
          DomainName: originDomain,
          OriginPath: formattedOriginPath,
          CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: 'https-only',
            OriginSslProtocols: {
              Quantity: 1,
              Items: ['TLSv1.2']
            },
            OriginReadTimeout: 30,
            OriginKeepaliveTimeout: 5
          }
        }
      ]
    },
    DefaultCacheBehavior: {
      TargetOriginId: 'default-origin',
      ViewerProtocolPolicy: 'redirect-to-https',
      AllowedMethods: {
        Quantity: 7,
        Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
        CachedMethods: {
          Quantity: 3,
          Items: ['GET', 'HEAD', 'OPTIONS']
        }
      },
      CachePolicyId: process.env.CUSTOM_CACHE_POLICY_ID || '658327ea-f89d-4fab-a63d-7e88639e58f6', // Custom CachingOptimized_CompressionDisabled or fallback
      OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // CORS-S3Origin
      Compress: false // Disabled to match custom cache policy
    },
    PriceClass: 'PriceClass_All',
    ViewerCertificate: {
      CloudFrontDefaultCertificate: true,
      MinimumProtocolVersion: 'TLSv1.2_2021',
      SSLSupportMethod: 'sni-only'
    },
    HttpVersion: 'http2and3',
    IsIPV6Enabled: true
  };
};

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    const body = JSON.parse(event.body);
    console.log('Request body:', JSON.stringify(body, null, 2));
    
    // Validate input
    if (!body.name) {
      return corsResponse(400, {
        message: 'Missing required field: name is required'
      });
    }
    
    // Generate a unique ID for our internal tracking
    const internalId = 'dist-' + uuidv4().substring(0, 8);
    console.log('Generated internal ID:', internalId);
    
    // Get user info from Cognito claims or use a default
    const user = event.requestContext?.authorizer?.claims?.email || 'unknown';
    console.log('User:', user);
    
    // Prepare CloudFront distribution configuration
    let distributionConfig;
    
    if (body.config && Object.keys(body.config).length > 0) {
      // Use provided configuration but ensure required fields are present
      distributionConfig = {
        ...body.config,
        CallerReference: `${body.name}-${Date.now()}`,
        Enabled: body.config.Enabled !== undefined ? body.config.Enabled : true,
        Comment: body.config.Comment || body.name
      };
      
      // Ensure DefaultCacheBehavior has all required fields
      if (distributionConfig.DefaultCacheBehavior) {
        // Always use the custom cache policy from environment variable
        distributionConfig.DefaultCacheBehavior.CachePolicyId = process.env.CUSTOM_CACHE_POLICY_ID || '658327ea-f89d-4fab-a63d-7e88639e58f6';
        
        // Ensure compression is disabled to match custom cache policy
        distributionConfig.DefaultCacheBehavior.Compress = false;
        
        // Ensure ForwardedValues is present if CachePolicyId is not provided
        if (!distributionConfig.DefaultCacheBehavior.CachePolicyId && 
            !distributionConfig.DefaultCacheBehavior.ForwardedValues) {
          distributionConfig.DefaultCacheBehavior.ForwardedValues = {
            QueryString: false,
            Cookies: {
              Forward: 'none'
            }
          };
        }
        
        // Ensure MinTTL is present if CachePolicyId is not provided
        if (!distributionConfig.DefaultCacheBehavior.CachePolicyId && 
            distributionConfig.DefaultCacheBehavior.MinTTL === undefined) {
          distributionConfig.DefaultCacheBehavior.MinTTL = 0;
        }
      }
      
      // Always enable HTTP/2 and HTTP/3 support
      distributionConfig.HttpVersion = 'http2and3';
      
      // Check if we need to modify the origin configuration for S3 buckets
      if (distributionConfig.Origins && distributionConfig.Origins.Items && distributionConfig.Origins.Items.length > 0) {
        // Process origins sequentially to handle async OAC lookup
        const processedOrigins = [];
        for (const origin of distributionConfig.Origins.Items) {
          console.log('Processing origin:', JSON.stringify(origin, null, 2));
          
          // Fix originPath if it's invalid
          if (origin.OriginPath !== undefined) {
            console.log('Original OriginPath:', origin.OriginPath);
            
            // If originPath is just '/' or empty, set it to empty string
            if (origin.OriginPath === '/' || origin.OriginPath === '') {
              origin.OriginPath = '';
              console.log('Set OriginPath to empty string');
            } else {
              // Ensure originPath starts with a forward slash
              if (!origin.OriginPath.startsWith('/')) {
                origin.OriginPath = '/' + origin.OriginPath;
              }
              
              // Remove trailing slash if present (unless it's the root path)
              if (origin.OriginPath.length > 1 && origin.OriginPath.endsWith('/')) {
                origin.OriginPath = origin.OriginPath.slice(0, -1);
              }
            }
            
            console.log('Final OriginPath:', origin.OriginPath);
          }
          
          // Check if this is an S3 bucket origin
          if (origin.DomainName && origin.DomainName.includes('s3.amazonaws.com')) {
            console.log('Detected S3 origin:', origin.DomainName);
            
            // If it's an S3 bucket, we need to determine if it's a website endpoint or a REST API endpoint
            if (origin.DomainName.includes('s3-website')) {
              console.log('Using CustomOriginConfig for S3 website endpoint');
              // S3 website endpoint - use CustomOriginConfig
              return {
                ...origin,
                CustomOriginConfig: origin.CustomOriginConfig || {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: 'http-only', // S3 websites only support HTTP
                  OriginSslProtocols: {
                    Quantity: 1,
                    Items: ['TLSv1.2']
                  },
                  OriginReadTimeout: 30,
                  OriginKeepaliveTimeout: 5
                }
              };
            } else {
              console.log('Using S3OriginConfig for S3 REST API endpoint');
              
              // Look up OAC ID for this S3 bucket
              let oacId = null;
              try {
                const bucketName = origin.DomainName.split('.')[0];
                const scanResult = await docClient.send(new ScanCommand({
                  TableName: process.env.ORIGINS_TABLE,
                  FilterExpression: 'bucketName = :bucketName',
                  ExpressionAttributeValues: {
                    ':bucketName': bucketName
                  }
                }));
                
                if (scanResult.Items && scanResult.Items.length > 0) {
                  oacId = scanResult.Items[0].oacId;
                  console.log(`Found OAC ID ${oacId} for bucket ${bucketName}`);
                }
              } catch (oacLookupError) {
                console.error('Error looking up OAC ID:', oacLookupError);
              }
              
              // S3 REST API endpoint - use S3OriginConfig with OAC
              const originConfig = {
                ...origin,
                S3OriginConfig: origin.S3OriginConfig || {
                  OriginAccessIdentity: ''  // Empty string when using OAC
                }
              };
              
              // Add OAC ID if found
              if (oacId) {
                originConfig.OriginAccessControlId = oacId;
                console.log(`Added OAC ID ${oacId} to origin configuration`);
              }
              
              processedOrigins.push(originConfig);
            }
          } else {
            console.log('Using origin as-is (not S3)');
            processedOrigins.push(origin);
          }
        }
        
        // Update the origins with processed ones
        distributionConfig.Origins.Items = processedOrigins;
      }
    } else {
      // Use default configuration with S3 website as origin if provided
      const originDomain = body.originDomain || 'example.com';
      const originPath = body.originPath || '';
      distributionConfig = getDefaultDistributionConfig(body.name, originDomain, originPath);
    }
    
    console.log('Final distribution config before CloudFront creation:', JSON.stringify(distributionConfig, null, 2));
    
    // Validate the distribution configuration
    const validationErrors = [];
    
    if (!distributionConfig.CallerReference) {
      validationErrors.push('CallerReference is required');
    }
    
    if (!distributionConfig.Origins || !distributionConfig.Origins.Items || distributionConfig.Origins.Items.length === 0) {
      validationErrors.push('At least one origin is required');
    }
    
    if (!distributionConfig.DefaultCacheBehavior) {
      validationErrors.push('DefaultCacheBehavior is required');
    } else {
      if (!distributionConfig.DefaultCacheBehavior.TargetOriginId) {
        validationErrors.push('DefaultCacheBehavior.TargetOriginId is required');
      }
      if (!distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy) {
        validationErrors.push('DefaultCacheBehavior.ViewerProtocolPolicy is required');
      }
    }
    
    // Check if TargetOriginId matches any origin ID
    if (distributionConfig.DefaultCacheBehavior && distributionConfig.DefaultCacheBehavior.TargetOriginId) {
      const originIds = distributionConfig.Origins.Items.map(origin => origin.Id);
      if (!originIds.includes(distributionConfig.DefaultCacheBehavior.TargetOriginId)) {
        validationErrors.push(`TargetOriginId '${distributionConfig.DefaultCacheBehavior.TargetOriginId}' does not match any origin ID. Available IDs: ${originIds.join(', ')}`);
      }
    }
    
    if (validationErrors.length > 0) {
      console.error('Distribution configuration validation errors:', validationErrors);
      return corsResponse(400, {
        success: false,
        message: 'Invalid distribution configuration',
        errors: validationErrors,
        config: distributionConfig
      });
    }
    
    console.log('Distribution configuration validation passed');
    
    // Store initial record in DynamoDB
    const timestamp = new Date().toISOString();
    const initialItem = {
      distributionId: internalId,
      name: body.name,
      status: 'Creating',
      config: distributionConfig,
      tags: body.tags || {},
      createdBy: user,
      createdAt: timestamp,
      updatedBy: user,
      updatedAt: timestamp,
      version: 1
    };
    
    try {
      // Store initial record in DynamoDB
      await docClient.send(new PutCommand({
        TableName: process.env.DISTRIBUTIONS_TABLE,
        Item: initialItem
      }));
      
      console.log('Initial distribution record created in DynamoDB');
      
      // Record history
      await docClient.send(new PutCommand({
        TableName: process.env.HISTORY_TABLE,
        Item: {
          distributionId: internalId,
          timestamp: timestamp,
          action: 'CREATE_INITIATED',
          user: user,
          version: 1
        }
      }));
      
      console.log('History record created in DynamoDB');
    } catch (dbError) {
      console.error('DynamoDB error:', dbError);
      return corsResponse(500, {
        success: false,
        message: 'Error storing distribution data',
        error: dbError.message,
        code: dbError.code
      });
    }
    
    // Create the actual CloudFront distribution
    try {
      console.log('About to create CloudFront distribution with config:', JSON.stringify(distributionConfig, null, 2));
      
      let createDistributionResult;
      
      if (body.tags && Object.keys(body.tags).length > 0) {
        // Convert tags object to CloudFront Tags format
        const tags = {
          Items: Object.entries(body.tags).map(([Key, Value]) => ({ Key, Value }))
        };
        
        console.log('Creating distribution with tags:', JSON.stringify(tags, null, 2));
        
        // Create distribution with tags
        const createDistributionWithTagsCommand = new CreateDistributionWithTagsCommand({
          DistributionConfigWithTags: {
            DistributionConfig: distributionConfig,
            Tags: {
              Items: tags.Items
            }
          }
        });
        
        createDistributionResult = await cloudfrontClient.send(createDistributionWithTagsCommand);
      } else {
        console.log('Creating distribution without tags');
        
        // Create distribution without tags
        const createDistributionCommand = new CreateDistributionCommand({
          DistributionConfig: distributionConfig
        });
        
        createDistributionResult = await cloudfrontClient.send(createDistributionCommand);
      }
      
      console.log('CloudFront distribution created successfully:', JSON.stringify(createDistributionResult, null, 2));
      
      // Extract the actual CloudFront distribution ID and domain name
      const actualDistributionId = createDistributionResult.Distribution.Id;
      const domainName = createDistributionResult.Distribution.DomainName;
      const status = createDistributionResult.Distribution.Status;
      const arn = `arn:aws:cloudfront::${process.env.AWS_ACCOUNT_ID || 'unknown'}:distribution/${actualDistributionId}`;
      
      // Update the DynamoDB record with the actual CloudFront distribution ID
      await docClient.send(new UpdateCommand({
        TableName: process.env.DISTRIBUTIONS_TABLE,
        Key: {
          distributionId: internalId
        },
        UpdateExpression: 'set cloudfrontId = :cfId, domainName = :domain, #s = :status, arn = :arn, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#s': 'status'
        },
        ExpressionAttributeValues: {
          ':cfId': actualDistributionId,
          ':domain': domainName,
          ':status': status,
          ':arn': arn,
          ':updatedAt': new Date().toISOString()
        },
        ReturnValues: 'UPDATED_NEW'
      }));
      
      console.log('DynamoDB record updated with actual CloudFront distribution ID');
      
      // Update origin's OAC and S3 bucket policy if using S3 origin
      try {
        await updateOriginOACPolicy(distributionConfig, arn, internalId);
      } catch (oacUpdateError) {
        console.error('Error updating origin OAC policy:', oacUpdateError);
        // Don't fail the distribution creation if OAC update fails
        console.log('Distribution created successfully, but OAC policy update failed');
      }
      
      // Record history
      await docClient.send(new PutCommand({
        TableName: process.env.HISTORY_TABLE,
        Item: {
          distributionId: internalId,
          timestamp: new Date().toISOString(),
          action: 'CREATE_COMPLETED',
          user: user,
          version: 2,
          cloudfrontId: actualDistributionId
        }
      }));
      
      // Start the deployment status monitoring state machine if available
      if (process.env.DEPLOYMENT_STATE_MACHINE_ARN) {
        try {
          await sfnClient.send(new StartExecutionCommand({
            stateMachineArn: process.env.DEPLOYMENT_STATE_MACHINE_ARN,
            input: JSON.stringify({
              distributionId: internalId,
              cloudfrontId: actualDistributionId
            })
          }));
          
          console.log('Deployment status monitoring started');
        } catch (sfnError) {
          console.error('Error starting state machine:', sfnError);
          // Continue even if state machine fails to start
        }
      }
      
      // Return success response
      return corsResponse(201, {
        success: true,
        data: {
          distribution: {
            id: internalId,
            cloudfrontId: actualDistributionId,
            name: body.name,
            status: status,
            domainName: domainName,
            createdAt: timestamp,
            config: distributionConfig
          }
        },
        message: 'Distribution created successfully'
      });
      
    } catch (cfError) {
      console.error('CloudFront error:', cfError);
      console.error('CloudFront error details:', {
        name: cfError.name,
        message: cfError.message,
        code: cfError.code,
        statusCode: cfError.$metadata?.httpStatusCode,
        requestId: cfError.$metadata?.requestId
      });
      
      // Update the DynamoDB record with the error
      try {
        await docClient.send(new UpdateCommand({
          TableName: process.env.DISTRIBUTIONS_TABLE,
          Key: {
            distributionId: internalId
          },
          UpdateExpression: 'set #s = :status, errorMessage = :error, updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#s': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'Failed',
            ':error': cfError.message,
            ':updatedAt': new Date().toISOString()
          },
          ReturnValues: 'UPDATED_NEW'
        }));
        
        // Record history
        await docClient.send(new PutCommand({
          TableName: process.env.HISTORY_TABLE,
          Item: {
            distributionId: internalId,
            timestamp: new Date().toISOString(),
            action: 'CREATE_FAILED',
            user: user,
            error: cfError.message,
            version: 1
          }
        }));
      } catch (updateError) {
        console.error('Error updating DynamoDB with failure status:', updateError);
      }
      
      // Return detailed error information
      return corsResponse(500, {
        success: false,
        message: 'Error creating CloudFront distribution',
        error: cfError.message,
        code: cfError.code,
        details: {
          distributionId: internalId,
          name: body.name,
          cfErrorName: cfError.name,
          statusCode: cfError.$metadata?.httpStatusCode,
          requestId: cfError.$metadata?.requestId
        }
      });
    }
    
  } catch (error) {
    console.error('Error processing request:', error);
    return corsResponse(500, {
      success: false,
      message: 'Error processing request',
      error: error.message,
      stack: error.stack
    });
  }
};
