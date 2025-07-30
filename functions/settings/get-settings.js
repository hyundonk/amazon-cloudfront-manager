const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

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
        
        if (!settingKey) {
            return corsResponse(400, {
                success: false,
                error: 'Setting key is required'
            });
        }

        // Get setting from DynamoDB
        const result = await dynamodb.send(new GetCommand({
            TableName: process.env.SETTINGS_TABLE,
            Key: {
                settingKey: settingKey
            }
        }));

        if (!result.Item) {
            // Return default values for known settings
            const defaultSettings = getDefaultSetting(settingKey);
            if (defaultSettings) {
                return corsResponse(200, {
                    success: true,
                    data: {
                        setting: defaultSettings
                    }
                });
            }
            
            return corsResponse(404, {
                success: false,
                error: 'Setting not found'
            });
        }

        return corsResponse(200, {
            success: true,
            data: {
                setting: result.Item
            }
        });

    } catch (error) {
        console.error('Error getting setting:', error);
        return corsResponse(500, {
            success: false,
            error: 'Failed to get setting',
            details: error.message
        });
    }
};

function getDefaultSetting(settingKey) {
    const accountId = process.env.AWS_ACCOUNT_ID || '123456789012';
    const randomString = Math.random().toString(36).substring(2, 8);
    
    switch (settingKey) {
        case 'consolidated-access-logs':
            return {
                settingKey: 'consolidated-access-logs',
                bucketName: `consolidated-access-logs-${accountId}-${randomString}`,
                enabled: false,
                outputFormat: 'json', // json or parquet
                partitioning: {
                    enabled: true,
                    pattern: 'year={year}/month={month}/day={day}/hour={hour}'
                },
                compression: 'gzip',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        default:
            return null;
    }
}
