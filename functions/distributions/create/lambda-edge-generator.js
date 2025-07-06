const { LambdaClient, CreateFunctionCommand, PublishVersionCommand, GetFunctionCommand, AddPermissionCommand } = require('@aws-sdk/client-lambda');
const { CloudFrontClient, GetDistributionCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const JSZip = require('jszip');

const lambda = new LambdaClient({ region: 'us-east-1' }); // Lambda@Edge must be in us-east-1
const cloudfront = new CloudFrontClient({ region: 'us-east-1' }); // CloudFront is global but uses us-east-1
const dynamodbClient = new DynamoDBClient();
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);

// Region mapping presets
const REGION_MAPPING_PRESETS = {
    'asia-us': {
        name: 'Asia-Pacific + Americas',
        description: '2-origin setup: Asia-Pacific regions + Rest of world',
        requiredOrigins: 2,
        mapping: {
            // Asia-Pacific regions -> origin1
            'ap-east-1': 'origin1',
            'ap-northeast-1': 'origin1',
            'ap-northeast-2': 'origin1',
            'ap-northeast-3': 'origin1',
            'ap-south-1': 'origin1',
            'ap-south-2': 'origin1',
            'ap-southeast-1': 'origin1',
            'ap-southeast-2': 'origin1',
            'ap-southeast-3': 'origin1',
            'ap-southeast-4': 'origin1',
            'ap-southeast-5': 'origin1',
            'ap-southeast-7': 'origin1',
            'me-central-1': 'origin1',
            
            // Rest of world -> origin2
            'us-east-1': 'origin2',
            'us-east-2': 'origin2',
            'us-west-1': 'origin2',
            'us-west-2': 'origin2',
            'ca-central-1': 'origin2',
            'ca-west-1': 'origin2',
            'eu-central-1': 'origin2',
            'eu-central-2': 'origin2',
            'eu-north-1': 'origin2',
            'eu-south-1': 'origin2',
            'eu-south-2': 'origin2',
            'eu-west-1': 'origin2',
            'eu-west-2': 'origin2',
            'eu-west-3': 'origin2',
            'af-south-1': 'origin2',
            'il-central-1': 'origin2',
            'me-south-1': 'origin2',
            'mx-central-1': 'origin2',
            'sa-east-1': 'origin2'
        }
    },
    
    'global-three': {
        name: 'Global 3-Region',
        description: '3-origin setup: Asia-Pacific, Americas, Europe+Others',
        requiredOrigins: 3,
        mapping: {
            // Asia-Pacific -> origin1
            'ap-east-1': 'origin1',
            'ap-northeast-1': 'origin1',
            'ap-northeast-2': 'origin1',
            'ap-northeast-3': 'origin1',
            'ap-south-1': 'origin1',
            'ap-south-2': 'origin1',
            'ap-southeast-1': 'origin1',
            'ap-southeast-2': 'origin1',
            'ap-southeast-3': 'origin1',
            'ap-southeast-4': 'origin1',
            'ap-southeast-5': 'origin1',
            'ap-southeast-7': 'origin1',
            'me-central-1': 'origin1',
            
            // Americas -> origin2
            'us-east-1': 'origin2',
            'us-east-2': 'origin2',
            'us-west-1': 'origin2',
            'us-west-2': 'origin2',
            'ca-central-1': 'origin2',
            'ca-west-1': 'origin2',
            'mx-central-1': 'origin2',
            'sa-east-1': 'origin2',
            
            // Europe and Others -> origin3
            'eu-central-1': 'origin3',
            'eu-central-2': 'origin3',
            'eu-north-1': 'origin3',
            'eu-south-1': 'origin3',
            'eu-south-2': 'origin3',
            'eu-west-1': 'origin3',
            'eu-west-2': 'origin3',
            'eu-west-3': 'origin3',
            'af-south-1': 'origin3',
            'il-central-1': 'origin3',
            'me-south-1': 'origin3'
        }
    }
};

/**
 * Generate Lambda@Edge function code
 */
const generateFunctionCode = (origins, preset) => {
    const presetConfig = REGION_MAPPING_PRESETS[preset];
    if (!presetConfig) {
        throw new Error(`Invalid preset: ${preset}`);
    }

    const defaultOrigin = origins.default;
    const additionalOrigins = origins.additional;

    // Validate origin count matches preset requirements
    if (additionalOrigins.length + 1 < presetConfig.requiredOrigins) {
        throw new Error(`Preset ${preset} requires ${presetConfig.requiredOrigins} origins, but only ${additionalOrigins.length + 1} provided`);
    }

    // Generate bucket variable declarations
    const bucketDeclarations = [
        `const defaultBucket = '${defaultOrigin.domainName}';`
    ];
    
    additionalOrigins.forEach((origin, index) => {
        bucketDeclarations.push(`const origin${index + 1}Bucket = '${origin.domainName}';`);
    });

    // Create region mapping with variable references
    const actualMapping = {};
    Object.entries(presetConfig.mapping).forEach(([region, originKey]) => {
        if (originKey === 'origin1' && additionalOrigins[0]) {
            actualMapping[region] = 'origin1Bucket';
        } else if (originKey === 'origin2' && additionalOrigins[1]) {
            actualMapping[region] = 'origin2Bucket';
        } else if (originKey === 'origin3' && additionalOrigins[2]) {
            actualMapping[region] = 'origin3Bucket';
        } else {
            actualMapping[region] = 'defaultBucket';
        }
    });

    // Convert mapping to use variable names instead of strings
    const mappingEntries = Object.entries(actualMapping).map(([region, variableName]) => {
        return `  "${region}": ${variableName}`;
    }).join(',\n');

    return `
// Generated Lambda@Edge function for multi-origin routing
// Preset: ${preset} (${presetConfig.name})
// Generated at: ${new Date().toISOString()}

${bucketDeclarations.join('\n')}

const regionsMapping = {
${mappingEntries}
};

exports.handler = async (event) => {
    const request = event.Records[0].cf.request;
    const region = process.env.AWS_REGION;
    
    try {
        console.log('Lambda@Edge execution region:', region);
        console.log('Request URI:', request.uri);
        
        // Get target origin based on region
        const domainName = regionsMapping[region] || defaultBucket;
        console.log('Selected origin:', domainName);
        
        setRequestOrigin(request, domainName);
    } catch (error) {
        console.error('Error processing request:', error.message || error);
        // Fallback to default origin on error
        setRequestOrigin(request, defaultBucket);
    }
    
    return request;
};

const setRequestOrigin = (request, domainName) => {
    request.origin.s3.authMethod = 'origin-access-identity';
    request.origin.s3.domainName = domainName;
    request.origin.s3.region = domainName.split('.')[2];
    request.headers['host'] = [{ key: 'host', value: domainName }];
};
    `.trim();
};

/**
 * Wait for Lambda function to become active
 */
const waitForFunctionActive = async (functionName, maxWaitTime = 60000) => {
    const startTime = Date.now();
    
    console.log(`Waiting for Lambda function ${functionName} to become active...`);
    
    while (Date.now() - startTime < maxWaitTime) {
        try {
            const result = await lambda.send(new GetFunctionCommand({
                FunctionName: functionName
            }));
            
            console.log(`Function state: ${result.Configuration.State}`);
            
            if (result.Configuration.State === 'Active') {
                console.log(`Lambda function ${functionName} is now active`);
                return true;
            }
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.error('Error checking function state:', error);
            throw error;
        }
    }
    
    throw new Error(`Lambda function ${functionName} did not become active within ${maxWaitTime}ms`);
};

/**
 * Create Lambda@Edge function in AWS
 */
const createLambdaFunction = async (functionName, code) => {
    // Create a ZIP file containing the Lambda function code
    const zip = new JSZip();
    zip.file('index.js', code);
    
    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    
    const params = {
        FunctionName: functionName,
        Runtime: 'nodejs18.x',
        Role: process.env.LAMBDA_EDGE_EXECUTION_ROLE_ARN,
        Handler: 'index.handler',
        Code: {
            ZipFile: zipBuffer
        },
        Description: 'Lambda@Edge function for multi-origin routing',
        Timeout: 5,
        MemorySize: 128,
        Publish: true // Required for Lambda@Edge
    };

    try {
        const result = await lambda.send(new CreateFunctionCommand(params));
        console.log('Lambda function created:', result.FunctionArn);
        return result;
    } catch (error) {
        console.error('Error creating Lambda function:', error);
        throw error;
    }
};

/**
 * Save Lambda@Edge function record to DynamoDB
 */
const saveFunctionRecord = async (functionData) => {
    const params = {
        TableName: process.env.LAMBDA_EDGE_FUNCTIONS_TABLE,
        Item: {
            functionId: functionData.functionId,
            functionName: functionData.functionName,
            functionArn: functionData.functionArn,
            versionArn: functionData.versionArn,
            codeContent: functionData.codeContent,
            origins: functionData.origins,
            regionMapping: functionData.regionMapping,
            preset: functionData.preset,
            createdBy: functionData.createdBy,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'active'
        }
    };

    try {
        await dynamodb.send(new PutCommand(params));
        console.log('Function record saved to DynamoDB');
    } catch (error) {
        console.error('Error saving function record:', error);
        throw error;
    }
};

/**
 * Wait for CloudFront distribution to reach Deployed state
 */
const waitForDistributionDeployed = async (distributionId, maxWaitTime = 900000) => { // 15 minutes max
    const startTime = Date.now();
    
    console.log(`Waiting for CloudFront distribution ${distributionId} to be deployed...`);
    
    while (Date.now() - startTime < maxWaitTime) {
        try {
            const result = await cloudfront.send(new GetDistributionCommand({
                Id: distributionId
            }));
            
            console.log(`Distribution status: ${result.Distribution.Status}`);
            
            if (result.Distribution.Status === 'Deployed') {
                console.log(`CloudFront distribution ${distributionId} is now deployed`);
                return true;
            }
            
            // Wait 30 seconds before checking again (CloudFront deployments are slow)
            await new Promise(resolve => setTimeout(resolve, 30000));
            
        } catch (error) {
            console.error('Error checking distribution status:', error);
            throw error;
        }
    }
    
    throw new Error(`CloudFront distribution ${distributionId} did not deploy within ${maxWaitTime}ms`);
};

/**
 * Trigger Lambda@Edge replication by updating CloudFront distribution
 * This mimics what the AWS console does to force immediate replication
 */
const triggerLambdaEdgeReplication = async (distributionId) => {
    try {
        console.log('Triggering Lambda@Edge replication for distribution:', distributionId);
        
        // First, wait for the distribution to be deployed
        await waitForDistributionDeployed(distributionId);
        
        // Get current distribution configuration
        const getResult = await cloudfront.send(new GetDistributionCommand({ 
            Id: distributionId 
        }));
        
        // Make a small update to trigger Lambda@Edge replication
        // This is what the AWS console does behind the scenes
        const currentConfig = getResult.Distribution.DistributionConfig;
        const updatedConfig = {
            ...currentConfig,
            // Add a timestamp to the comment to trigger an update
            Comment: currentConfig.Comment + ` - Lambda@Edge replication triggered at ${new Date().toISOString()}`
        };
        
        const updateParams = {
            Id: distributionId,
            DistributionConfig: updatedConfig,
            IfMatch: getResult.ETag
        };
        
        await cloudfront.send(new UpdateDistributionCommand(updateParams));
        console.log('Successfully triggered Lambda@Edge replication via CloudFront update');
        
        return true;
    } catch (error) {
        console.error('Failed to trigger Lambda@Edge replication:', error.message);
        // Don't fail the entire process if replication trigger fails
        return false;
    }
};

/**
 * Main function to create Lambda@Edge function
 */
const createLambdaEdgeFunction = async (config) => {
    const { name, origins, preset, createdBy } = config;
    const functionId = `func-${uuidv4().substring(0, 8)}`;
    const functionName = `${name}-${functionId}`;

    try {
        // Generate function code
        const codeContent = generateFunctionCode(origins, preset);
        
        // Create Lambda function
        const lambdaResult = await createLambdaFunction(functionName, codeContent);
        
        // Prepare function data
        const functionData = {
            functionId,
            functionName,
            functionArn: lambdaResult.FunctionArn,
            versionArn: lambdaResult.FunctionArn, // This should be the versioned ARN since Publish: true
            codeContent,
            origins,
            regionMapping: REGION_MAPPING_PRESETS[preset].mapping,
            preset,
            createdBy
        };

        console.log('Lambda function ARN:', lambdaResult.FunctionArn);
        console.log('Lambda function Version:', lambdaResult.Version);
        
        // Ensure we have a versioned ARN for CloudFront
        // CloudFront requires the ARN to end with a version number
        if (!functionData.versionArn.match(/:\d+$/)) {
            // If the ARN doesn't end with a version number, append it
            functionData.versionArn = `${lambdaResult.FunctionArn}:${lambdaResult.Version || '1'}`;
            console.log('Updated versionArn for CloudFront:', functionData.versionArn);
        }
        
        // Wait for the Lambda function to become active before proceeding
        // CloudFront requires the function to be in Active state
        await waitForFunctionActive(functionName);
        
        // Add permission for CloudFront to invoke the Lambda function
        try {
            await lambda.send(new AddPermissionCommand({
                FunctionName: functionName,
                StatementId: `cloudfront-invoke-${Date.now()}`,
                Action: 'lambda:InvokeFunction',
                Principal: 'edgelambda.amazonaws.com'
            }));
            console.log('Added CloudFront invoke permission to Lambda function');
        } catch (permissionError) {
            // Permission might already exist, log but don't fail
            console.log('CloudFront permission may already exist:', permissionError.message);
        }
        
        // Save to DynamoDB
        await saveFunctionRecord(functionData);
        
        return functionData;
    } catch (error) {
        console.error('Error creating Lambda@Edge function:', error);
        throw error;
    }
};

module.exports = {
    createLambdaEdgeFunction,
    generateFunctionCode,
    triggerLambdaEdgeReplication,
    waitForDistributionDeployed,
    REGION_MAPPING_PRESETS
};
