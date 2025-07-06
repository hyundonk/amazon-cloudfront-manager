const { LambdaClient, CreateFunctionCommand, AddPermissionCommand, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const JSZip = require('jszip');

const lambda = new LambdaClient({ region: 'us-east-1' }); // Lambda@Edge must be in us-east-1
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient());

// CORS headers
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
};

const corsResponse = (statusCode, body) => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

const handleCorsPreflightRequest = () => ({
    statusCode: 200,
    headers: CORS_HEADERS,
    body: ''
});

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

    // Create region mapping with actual bucket names
    const actualMapping = {};
    Object.entries(presetConfig.mapping).forEach(([region, originKey]) => {
        if (originKey === 'origin1' && additionalOrigins[0]) {
            actualMapping[region] = additionalOrigins[0].domainName;
        } else if (originKey === 'origin2' && additionalOrigins[1]) {
            actualMapping[region] = additionalOrigins[1].domainName;
        } else if (originKey === 'origin3' && additionalOrigins[2]) {
            actualMapping[region] = additionalOrigins[2].domainName;
        } else {
            actualMapping[region] = defaultOrigin.domainName;
        }
    });

    return `
// Generated Lambda@Edge function for multi-origin routing
// Preset: ${preset} (${presetConfig.name})
// Generated at: ${new Date().toISOString()}

${bucketDeclarations.join('\n')}

const regionsMapping = ${JSON.stringify(actualMapping, null, 2)};

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
    // Create proper ZIP file
    const zip = new JSZip();
    zip.file('index.js', code);
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
        
        // Wait for function to become active
        await waitForFunctionActive(functionName);
        
        // Add CloudFront invoke permission
        await lambda.send(new AddPermissionCommand({
            FunctionName: functionName,
            StatementId: `cloudfront-invoke-${Date.now()}`,
            Action: 'lambda:InvokeFunction',
            Principal: 'edgelambda.amazonaws.com'
        }));
        
        console.log('CloudFront invoke permission added');
        
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
 * Main function to create Lambda@Edge function
 */
const createLambdaEdgeFunction = async (config) => {
    const { name, origins, preset, createdBy } = config;
    const functionId = `func-${uuidv4().substring(0, 8)}`;
    const functionName = `${name}-multi-origin-func-${functionId}`;

    try {
        // Generate function code
        const codeContent = generateFunctionCode(origins, preset);
        
        // Create Lambda function
        const lambdaResult = await createLambdaFunction(functionName, codeContent);
        
        // Ensure versioned ARN format
        let versionArn = lambdaResult.FunctionArn;
        if (!versionArn.match(/:\d+$/)) {
            versionArn = `${lambdaResult.FunctionArn}:${lambdaResult.Version || '1'}`;
        }
        
        // Prepare function data
        const functionData = {
            functionId,
            functionName,
            functionArn: lambdaResult.FunctionArn,
            versionArn: versionArn,
            codeContent,
            origins,
            regionMapping: REGION_MAPPING_PRESETS[preset].mapping,
            preset,
            createdBy
        };
        
        // Save to DynamoDB
        await saveFunctionRecord(functionData);
        
        return functionData;
    } catch (error) {
        console.error('Error creating Lambda@Edge function:', error);
        throw error;
    }
};

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }

    try {
        const body = JSON.parse(event.body);
        const { name, origins, preset } = body;
        
        // Get user from JWT token
        const createdBy = event.requestContext.authorizer.claims.email;

        // Validate input
        if (!name || !origins || !preset) {
            return corsResponse(400, {
                success: false,
                error: 'Missing required fields: name, origins, preset'
            });
        }

        if (!origins.default || !origins.additional || origins.additional.length === 0) {
            return corsResponse(400, {
                success: false,
                error: 'Must provide default origin and at least one additional origin'
            });
        }

        // Create Lambda@Edge function
        const functionData = await createLambdaEdgeFunction({
            name,
            origins,
            preset,
            createdBy
        });

        return corsResponse(200, {
            success: true,
            data: {
                functionId: functionData.functionId,
                functionName: functionData.functionName,
                functionArn: functionData.functionArn,
                versionArn: functionData.versionArn,
                preset: functionData.preset,
                status: 'active'
            }
        });

    } catch (error) {
        console.error('Error creating Lambda@Edge function:', error);
        return corsResponse(500, {
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};
