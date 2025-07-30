const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand } = require('@aws-sdk/client-s3');

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());
const s3 = new S3Client();

const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
};

function corsResponse(statusCode, body) {
    return {
        statusCode: statusCode,
        headers: CORS_HEADERS,
        body: JSON.stringify(body)
    };
}

function handleCorsPreflightRequest() {
    return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: ''
    };
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }

    try {
        const settingKey = event.pathParameters?.key;
        const requestBody = JSON.parse(event.body || '{}');
        
        if (!settingKey) {
            return corsResponse(400, {
                success: false,
                error: 'Setting key is required'
            });
        }

        // Validate setting data based on key
        const validationResult = validateSetting(settingKey, requestBody);
        if (!validationResult.valid) {
            return corsResponse(400, {
                success: false,
                error: validationResult.error
            });
        }

        // Get existing setting
        const existingResult = await dynamodb.send(new GetCommand({
            TableName: process.env.SETTINGS_TABLE,
            Key: {
                settingKey: settingKey
            }
        }));

        const now = new Date().toISOString();
        const settingData = {
            settingKey: settingKey,
            ...requestBody,
            updatedAt: now,
            createdAt: existingResult.Item?.createdAt || now
        };

        // Special handling for consolidated-access-logs setting
        if (settingKey === 'consolidated-access-logs') {
            const bucketResult = await ensureAccessLogsBucket(settingData.bucketName);
            if (!bucketResult.success) {
                return corsResponse(500, {
                    success: false,
                    error: 'Failed to create or validate access logs bucket',
                    details: bucketResult.error
                });
            }
            settingData.bucketCreated = bucketResult.created;
            settingData.bucketRegion = bucketResult.region;
        }

        // Save setting to DynamoDB
        await dynamodb.send(new PutCommand({
            TableName: process.env.SETTINGS_TABLE,
            Item: settingData
        }));

        return corsResponse(200, {
            success: true,
            data: {
                setting: settingData
            },
            message: 'Setting updated successfully'
        });

    } catch (error) {
        console.error('Error updating setting:', error);
        return corsResponse(500, {
            success: false,
            error: 'Failed to update setting',
            details: error.message
        });
    }
};

function validateSetting(settingKey, data) {
    switch (settingKey) {
        case 'consolidated-access-logs':
            if (!data.bucketName || typeof data.bucketName !== 'string') {
                return { valid: false, error: 'bucketName is required and must be a string' };
            }
            if (!data.bucketName.match(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)) {
                return { valid: false, error: 'bucketName must follow S3 bucket naming conventions' };
            }
            if (data.outputFormat && !['json', 'parquet'].includes(data.outputFormat)) {
                return { valid: false, error: 'outputFormat must be either "json" or "parquet"' };
            }
            if (data.compression && !['gzip', 'none'].includes(data.compression)) {
                return { valid: false, error: 'compression must be either "gzip" or "none"' };
            }
            return { valid: true };
        default:
            return { valid: true };
    }
}

async function ensureAccessLogsBucket(bucketName) {
    try {
        // Check if bucket exists
        try {
            await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
            console.log(`Bucket ${bucketName} already exists`);
            return { success: true, created: false, region: process.env.AWS_REGION };
        } catch (error) {
            if (error.name !== 'NotFound') {
                throw error;
            }
        }

        // Create bucket if it doesn't exist
        const createBucketParams = {
            Bucket: bucketName
        };

        // Add LocationConstraint for regions other than us-east-1
        if (process.env.AWS_REGION !== 'us-east-1') {
            createBucketParams.CreateBucketConfiguration = {
                LocationConstraint: process.env.AWS_REGION
            };
        }

        await s3.send(new CreateBucketCommand(createBucketParams));
        console.log(`Created bucket ${bucketName}`);

        // Set bucket policy for CloudWatch Logs delivery
        const bucketPolicy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Sid: 'AllowCloudWatchLogsDelivery',
                    Effect: 'Allow',
                    Principal: {
                        Service: 'delivery.logs.amazonaws.com'
                    },
                    Action: 's3:PutObject',
                    Resource: `arn:aws:s3:::${bucketName}/*`,
                    Condition: {
                        StringEquals: {
                            's3:x-amz-acl': 'bucket-owner-full-control'
                        }
                    }
                },
                {
                    Sid: 'AllowCloudWatchLogsDeliveryGetBucketAcl',
                    Effect: 'Allow',
                    Principal: {
                        Service: 'delivery.logs.amazonaws.com'
                    },
                    Action: 's3:GetBucketAcl',
                    Resource: `arn:aws:s3:::${bucketName}`
                }
            ]
        };

        await s3.send(new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify(bucketPolicy)
        }));

        return { success: true, created: true, region: process.env.AWS_REGION };

    } catch (error) {
        console.error('Error ensuring access logs bucket:', error);
        return { success: false, error: error.message };
    }
}
