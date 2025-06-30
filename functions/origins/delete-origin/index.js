const { S3Client, DeleteBucketCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client();

const ORIGINS_TABLE = process.env.ORIGINS_TABLE;

/**
 * Deletes an S3 origin and its associated bucket
 */
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        // Extract originId from path parameters
        const originId = event.pathParameters?.originId;
        
        if (!originId) {
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
                },
                body: JSON.stringify({
                    success: false,
                    error: "Missing originId parameter"
                })
            };
        }
        
        // Get the origin details from DynamoDB
        const getParams = {
            TableName: ORIGINS_TABLE,
            Key: { originId }
        };
        
        const { Item: origin } = await docClient.send(new GetCommand(getParams));
        
        if (!origin) {
            return {
                statusCode: 404,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
                },
                body: JSON.stringify({
                    success: false,
                    error: "Origin not found"
                })
            };
        }
        
        // Empty the S3 bucket before deleting it
        await emptyS3Bucket(origin.bucketName);
        
        // Delete the S3 bucket
        await s3Client.send(new DeleteBucketCommand({
            Bucket: origin.bucketName
        }));
        
        // Delete the origin record from DynamoDB
        const deleteParams = {
            TableName: ORIGINS_TABLE,
            Key: { originId }
        };
        
        await docClient.send(new DeleteCommand(deleteParams));
        
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
            },
            body: JSON.stringify({
                success: true,
                message: `Origin ${originId} and bucket ${origin.bucketName} deleted successfully`
            })
        };
    } catch (error) {
        console.error('Error:', error);
        
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
            },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};

/**
 * Empties an S3 bucket by deleting all objects
 */
async function emptyS3Bucket(bucketName) {
    let continuationToken;
    
    do {
        // List objects in the bucket
        const listParams = {
            Bucket: bucketName,
            ContinuationToken: continuationToken
        };
        
        const listedObjects = await s3Client.send(new ListObjectsV2Command(listParams));
        
        if (listedObjects.Contents?.length > 0) {
            // Create delete objects command
            const deleteParams = {
                Bucket: bucketName,
                Delete: {
                    Objects: listedObjects.Contents.map(({ Key }) => ({ Key }))
                }
            };
            
            // Delete objects
            await s3Client.send(new DeleteObjectsCommand(deleteParams));
        }
        
        continuationToken = listedObjects.NextContinuationToken;
    } while (continuationToken);
}
