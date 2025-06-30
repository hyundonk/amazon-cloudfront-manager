const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, DeleteOriginAccessControlCommand } = require('@aws-sdk/client-cloudfront');

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
const cloudfrontClient = new CloudFrontClient();

// Helper function to empty an S3 bucket
async function emptyS3Bucket(bucketName) {
  let isTruncated = true;
  let continuationToken = null;
  
  while (isTruncated) {
    const listParams = {
      Bucket: bucketName
    };
    
    if (continuationToken) {
      listParams.ContinuationToken = continuationToken;
    }
    
    const listResult = await s3Client.send(new ListObjectsV2Command(listParams));
    
    if (listResult.Contents && listResult.Contents.length > 0) {
      for (const object of listResult.Contents) {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: object.Key
        }));
        console.log(`Deleted object ${object.Key} from bucket ${bucketName}`);
      }
    }
    
    isTruncated = listResult.IsTruncated;
    continuationToken = listResult.NextContinuationToken;
  }
}

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Environment variables:', {
    ORIGINS_TABLE: process.env.ORIGINS_TABLE,
    DISTRIBUTIONS_TABLE: process.env.DISTRIBUTIONS_TABLE,
    TEMPLATES_TABLE: process.env.TEMPLATES_TABLE,
    HISTORY_TABLE: process.env.HISTORY_TABLE
  });
  
  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return handleCorsPreflightRequest();
  }
  
  try {
    console.log('Path parameters:', event.pathParameters);
    const originId = event.pathParameters?.id;
    
    // Validate input
    if (!originId) {
      console.error('Origin ID is missing from path parameters');
      return corsResponse(400, {
        success: false,
        message: 'Origin ID is required',
        pathParameters: event.pathParameters
      });
    }
    
    // Check if ORIGINS_TABLE environment variable is set
    if (!process.env.ORIGINS_TABLE) {
      console.error('ORIGINS_TABLE environment variable is not set');
      return corsResponse(500, {
        success: false,
        message: 'Server configuration error: ORIGINS_TABLE not configured'
      });
    }
    
    // Get the origin from DynamoDB
    const getResult = await docClient.send(new GetCommand({
      TableName: process.env.ORIGINS_TABLE,
      Key: {
        originId: originId
      }
    }));
    
    if (!getResult.Item) {
      return corsResponse(404, {
        success: false,
        message: `Origin with ID ${originId} not found`
      });
    }
    
    const origin = getResult.Item;
    const bucketName = origin.bucketName;
    const oacId = origin.oacId;
    
    // Check if there are any distributions still using this origin
    if (origin.distributionArns && origin.distributionArns.length > 0) {
      return corsResponse(400, {
        success: false,
        message: 'Cannot delete origin - it is still being used by distributions',
        distributionsUsing: origin.distributionArns
      });
    }
    
    // Delete Origin Access Control (OAC) if it exists
    if (oacId) {
      try {
        await cloudfrontClient.send(new DeleteOriginAccessControlCommand({
          Id: oacId
        }));
        console.log(`OAC ${oacId} deleted successfully`);
      } catch (oacError) {
        console.error('Error deleting OAC:', oacError);
        // Continue with S3 deletion even if OAC deletion fails
        console.log('Continuing with S3 bucket deletion...');
      }
    }
    
    // Delete S3 bucket
    try {
      // Empty the bucket first
      await emptyS3Bucket(bucketName);
      
      // Delete the bucket
      await s3Client.send(new DeleteBucketCommand({
        Bucket: bucketName
      }));
      
      console.log(`Bucket ${bucketName} deleted successfully`);
    } catch (s3Error) {
      console.error('Error deleting S3 bucket:', s3Error);
      return corsResponse(500, {
        success: false,
        message: 'Error deleting S3 bucket',
        error: s3Error.message
      });
    }
    
    // Delete the origin from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: process.env.ORIGINS_TABLE,
      Key: {
        originId: originId
      }
    }));
    
    return corsResponse(200, {
      success: true,
      message: `Origin ${originId} and bucket ${bucketName} deleted successfully`
    });
  } catch (error) {
    console.error('Error deleting origin:', error);
    return corsResponse(500, {
      success: false,
      message: 'Error deleting origin',
      error: error.message
    });
  }
};
