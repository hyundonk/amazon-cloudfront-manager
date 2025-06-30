"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CfManagerBackendStack = void 0;
const cdk = require("aws-cdk-lib");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const sfn = require("aws-cdk-lib/aws-stepfunctions");
const tasks = require("aws-cdk-lib/aws-stepfunctions-tasks");
const logs = require("aws-cdk-lib/aws-logs");
class CfManagerBackendStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // API Gateway with Cognito authorizer
        this.api = new apigateway.RestApi(this, 'CfManagerApi', {
            description: 'CloudFront Manager API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token'
                ],
                maxAge: cdk.Duration.days(1)
            },
            deployOptions: {
                stageName: 'api',
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
                metricsEnabled: true,
            }
        });
        // Cognito authorizer
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CfManagerAuthorizer', {
            cognitoUserPools: [props.userPool],
            identitySource: 'method.request.header.Authorization'
        });
        // Common Lambda environment variables
        const lambdaEnv = {
            DISTRIBUTIONS_TABLE: props.distributionsTable.tableName,
            TEMPLATES_TABLE: props.templatesTable.tableName,
            HISTORY_TABLE: props.historyTable.tableName,
            ORIGINS_TABLE: props.originsTable.tableName,
        };
        // Lambda execution role
        const lambdaRole = new iam.Role(this, 'LambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ]
        });
        // Add CloudFront permissions
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudfront:Get*',
                'cloudfront:List*',
                'cloudfront:Create*',
                'cloudfront:Update*',
                'cloudfront:Delete*',
                'cloudfront:TagResource',
                'cloudfront:UntagResource',
                'cloudfront:CreateInvalidation'
            ],
            resources: ['*']
        }));
        // Add S3 permissions for Origins management
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:CreateBucket',
                's3:DeleteBucket',
                's3:ListBucket',
                's3:GetBucketLocation',
                's3:GetBucketPolicy',
                's3:PutBucketPolicy',
                's3:DeleteBucketPolicy',
                's3:PutBucketWebsite',
                's3:DeleteBucketWebsite',
                's3:GetBucketWebsite',
                's3:PutBucketCORS',
                's3:GetBucketCORS',
                's3:DeleteBucketCORS',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListObjects',
                's3:ListObjectsV2'
            ],
            resources: ['*']
        }));
        // Add Lambda invoke permissions to the role
        lambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'lambda:InvokeFunction'
            ],
            resources: ['*']
        }));
        // Grant DynamoDB permissions
        props.distributionsTable.grantReadWriteData(lambdaRole);
        props.templatesTable.grantReadWriteData(lambdaRole);
        props.historyTable.grantReadWriteData(lambdaRole);
        props.originsTable.grantReadWriteData(lambdaRole); // Add permissions for Origins table
        // Define Step Function Lambda functions first
        const checkDeploymentStatus = new lambda.Function(this, 'CheckDeploymentStatusFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/common/checkDeploymentStatus', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/common/checkDeploymentStatus && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Checks the deployment status of a CloudFront distribution'
        });
        const updateDistributionStatus = new lambda.Function(this, 'UpdateDistributionStatusFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/common/updateDistributionStatus', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/common/updateDistributionStatus && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Updates the status of a CloudFront distribution in DynamoDB'
        });
        // Define Step Function
        const checkStatus = new tasks.LambdaInvoke(this, 'Check Deployment Status', {
            lambdaFunction: checkDeploymentStatus,
            outputPath: '$.Payload',
        });
        const updateStatus = new tasks.LambdaInvoke(this, 'Update Distribution Status', {
            lambdaFunction: updateDistributionStatus,
            outputPath: '$.Payload',
        });
        const wait30Seconds = new sfn.Wait(this, 'Wait 30 Seconds', {
            time: sfn.WaitTime.duration(cdk.Duration.seconds(30)),
        });
        const isDeployed = new sfn.Choice(this, 'Is Deployed?');
        const deploymentComplete = new sfn.Succeed(this, 'Deployment Complete');
        const definition = checkStatus
            .next(isDeployed
            .when(sfn.Condition.stringEquals('$.status', 'Deployed'), updateStatus)
            .when(sfn.Condition.stringEquals('$.status', 'InProgress'), wait30Seconds.next(checkStatus))
            .otherwise(updateStatus));
        updateStatus.next(deploymentComplete);
        // Create the state machine before the Lambda functions that need it
        const deploymentStateMachine = new sfn.StateMachine(this, 'DeploymentStateMachine', {
            definition,
            timeout: cdk.Duration.hours(2),
            logs: {
                destination: new logs.LogGroup(this, 'DeploymentStateMachineLogs', {
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: cdk.RemovalPolicy.DESTROY
                }),
                level: sfn.LogLevel.ALL
            }
        });
        // Create Lambda functions for distributions
        const listDistributionsFunction = new lambda.Function(this, 'ListDistributionsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/list'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Lists CloudFront distributions'
        });
        const getDistributionFunction = new lambda.Function(this, 'GetDistributionFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/get'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Gets a CloudFront distribution'
        });
        // Create the main distribution function with AWS SDK v3
        const createDistributionFunction = new lambda.Function(this, 'CreateDistributionFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/create', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-sfn',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/distributions/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-sfn && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: {
                ...lambdaEnv,
                AWS_ACCOUNT_ID: this.account,
                DEPLOYMENT_STATE_MACHINE_ARN: deploymentStateMachine.stateMachineArn
            },
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Creates a CloudFront distribution'
        });
        // Create proxy function for handling CORS and invoking the main function
        const createDistributionProxyFunction = new lambda.Function(this, 'CreateDistributionProxyFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/create-proxy', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-lambda',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/distributions/create-proxy && npm install && npm install @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: {
                TARGET_FUNCTION_NAME: createDistributionFunction.functionName
            },
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Proxy for creating CloudFront distributions with proper CORS handling'
        });
        const updateDistributionFunction = new lambda.Function(this, 'UpdateDistributionFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/update'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Updates a CloudFront distribution'
        });
        const deleteDistributionFunction = new lambda.Function(this, 'DeleteDistributionFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/delete'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Deletes a CloudFront distribution'
        });
        const getDistributionStatusFunction = new lambda.Function(this, 'GetDistributionStatusFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/getStatus'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Gets the status of a CloudFront distribution'
        });
        const invalidateDistributionFunction = new lambda.Function(this, 'InvalidateDistributionFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/invalidate'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Creates an invalidation for a CloudFront distribution'
        });
        // Create Lambda functions for origins
        const listOriginsFunction = new lambda.Function(this, 'ListOriginsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/origins/list'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Lists S3 origins for CloudFront distributions'
        });
        const getOriginFunction = new lambda.Function(this, 'GetOriginFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/origins/get'),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Gets an S3 origin for CloudFront distributions'
        });
        const createOriginFunction = new lambda.Function(this, 'CreateOriginFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/origins/create', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/origins/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(60),
            memorySize: 256,
            description: 'Creates an S3 origin for CloudFront distributions'
        });
        const updateOriginFunction = new lambda.Function(this, 'UpdateOriginFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/origins/update', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/origins/update && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(60),
            memorySize: 256,
            description: 'Updates an S3 origin for CloudFront distributions'
        });
        const deleteOriginFunction = new lambda.Function(this, 'DeleteOriginFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/origins/delete', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/origins/delete && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(60),
            memorySize: 256,
            description: 'Deletes an S3 origin for CloudFront distributions'
        });
        // Create Lambda functions for templates
        const listTemplatesFunction = new lambda.Function(this, 'ListTemplatesFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/list', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/list && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Lists CloudFront distribution templates'
        });
        const getTemplateFunction = new lambda.Function(this, 'GetTemplateFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/get', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/get && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Gets a CloudFront distribution template'
        });
        const createTemplateFunction = new lambda.Function(this, 'CreateTemplateFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/create', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb uuid',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb uuid && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Creates a CloudFront distribution template'
        });
        // Create proxy function for handling CORS and invoking the main function
        const createTemplateProxyFunction = new lambda.Function(this, 'CreateTemplateProxyFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/create-proxy', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-lambda',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/create-proxy && npm install && npm install @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: {
                TARGET_FUNCTION_NAME: createTemplateFunction.functionName
            },
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Proxy for creating CloudFront distribution templates with proper CORS handling'
        });
        const updateTemplateFunction = new lambda.Function(this, 'UpdateTemplateFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/update', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/update && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Updates a CloudFront distribution template'
        });
        const deleteTemplateFunction = new lambda.Function(this, 'DeleteTemplateFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/delete', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/delete && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: lambdaEnv,
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Deletes a CloudFront distribution template'
        });
        const applyTemplateFunction = new lambda.Function(this, 'ApplyTemplateFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/templates/apply', {
                bundling: {
                    image: lambda.Runtime.NODEJS_18_X.bundlingImage,
                    command: [
                        'bash', '-c', [
                            'npm install',
                            'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-lambda',
                            'cp -r /asset-input/* /asset-output/',
                            'cp -r node_modules /asset-output/'
                        ].join(' && ')
                    ],
                    local: {
                        tryBundle(outputDir) {
                            require('child_process').execSync(`cd functions/templates/apply && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`, { stdio: 'inherit' });
                            return true;
                        }
                    }
                }
            }),
            environment: {
                ...lambdaEnv,
                CREATE_DISTRIBUTION_FUNCTION: createDistributionFunction.functionName
            },
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            description: 'Applies a CloudFront distribution template'
        });
        // Create API resources and methods
        const distributionsResource = this.api.root.addResource('distributions');
        const distributionResource = distributionsResource.addResource('{id}');
        const distributionStatusResource = distributionResource.addResource('status');
        const distributionInvalidateResource = distributionResource.addResource('invalidate');
        const templatesResource = this.api.root.addResource('templates');
        const templateResource = templatesResource.addResource('{id}');
        const templateApplyResource = templateResource.addResource('apply');
        // Configure API methods for distributions
        distributionsResource.addMethod('GET', new apigateway.LambdaIntegration(listDistributionsFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Use the proxy function for POST method to handle CORS properly
        distributionsResource.addMethod('POST', new apigateway.LambdaIntegration(createDistributionProxyFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        distributionResource.addMethod('GET', new apigateway.LambdaIntegration(getDistributionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        distributionResource.addMethod('PUT', new apigateway.LambdaIntegration(updateDistributionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        distributionResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteDistributionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        distributionStatusResource.addMethod('GET', new apigateway.LambdaIntegration(getDistributionStatusFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        distributionInvalidateResource.addMethod('POST', new apigateway.LambdaIntegration(invalidateDistributionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Configure API methods for templates
        templatesResource.addMethod('GET', new apigateway.LambdaIntegration(listTemplatesFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Use the proxy function for POST method to handle CORS properly
        templatesResource.addMethod('POST', new apigateway.LambdaIntegration(createTemplateProxyFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        templateResource.addMethod('GET', new apigateway.LambdaIntegration(getTemplateFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        templateResource.addMethod('PUT', new apigateway.LambdaIntegration(updateTemplateFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        templateResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteTemplateFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        templateApplyResource.addMethod('POST', new apigateway.LambdaIntegration(applyTemplateFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Create API resources and methods for origins
        const originsResource = this.api.root.addResource('origins');
        const originResource = originsResource.addResource('{id}');
        // Configure API methods for origins
        originsResource.addMethod('GET', new apigateway.LambdaIntegration(listOriginsFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        originsResource.addMethod('POST', new apigateway.LambdaIntegration(createOriginFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        originResource.addMethod('GET', new apigateway.LambdaIntegration(getOriginFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        originResource.addMethod('PUT', new apigateway.LambdaIntegration(updateOriginFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        originResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteOriginFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO
        });
        // Outputs
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.api.url,
            description: 'API Gateway Endpoint URL'
        });
        new cdk.CfnOutput(this, 'DeploymentStateMachineArn', {
            value: deploymentStateMachine.stateMachineArn,
            description: 'Deployment State Machine ARN'
        });
    }
}
exports.CfManagerBackendStack = CfManagerBackendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2YtbWFuYWdlci1iYWNrZW5kLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vbGliL2NmLW1hbmFnZXItYmFja2VuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFFbkMseURBQXlEO0FBQ3pELGlEQUFpRDtBQUdqRCwyQ0FBMkM7QUFDM0MscURBQXFEO0FBQ3JELDZEQUE2RDtBQUM3RCw2Q0FBNkM7QUFXN0MsTUFBYSxxQkFBc0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUdsRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHNDQUFzQztRQUN0QyxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RELFdBQVcsRUFBRSx3QkFBd0I7WUFDckMsMkJBQTJCLEVBQUU7Z0JBQzNCLFlBQVksRUFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLFdBQVc7Z0JBQ3pDLFlBQVksRUFBRSxVQUFVLENBQUMsSUFBSSxDQUFDLFdBQVc7Z0JBQ3pDLFlBQVksRUFBRTtvQkFDWixjQUFjO29CQUNkLFlBQVk7b0JBQ1osZUFBZTtvQkFDZixXQUFXO29CQUNYLHNCQUFzQjtpQkFDdkI7Z0JBQ0QsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQzthQUM3QjtZQUNELGFBQWEsRUFBRTtnQkFDYixTQUFTLEVBQUUsS0FBSztnQkFDaEIsWUFBWSxFQUFFLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO2dCQUNoRCxnQkFBZ0IsRUFBRSxJQUFJO2dCQUN0QixjQUFjLEVBQUUsSUFBSTthQUNyQjtTQUNGLENBQUMsQ0FBQztRQUVILHFCQUFxQjtRQUNyQixNQUFNLFVBQVUsR0FBRyxJQUFJLFVB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RCxDQUFDLENBQUM7UUFFSCxjQUFjLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFO1lBQ3RGLFVBQVU7WUFDVixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCxjQUFjLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFO1lBQ3pGLFVBQVU7WUFDVixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztTQUN4RCxDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRztZQUNuQixXQUFXLEVBQUUsMEJBQTBCO1NBQ3hDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMkJBQTJCLEVBQUU7WUFDbkQsS0FBSyxFQUFFLHNCQUFzQixDQUFDLGVBQWU7WUFDN0MsV0FBVyxFQUFFLDhCQUE4QjtTQUM1QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0ekJELHNEQXN6QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNmbiBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgKiBhcyB0YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmludGVyZmFjZSBDZk1hbmFnZXJCYWNrZW5kU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XG4gIGRpc3RyaWJ1dGlvbnNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHRlbXBsYXRlc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgaGlzdG9yeVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgb3JpZ2luc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbn1cblxuZXhwb3J0IGNsYXNzIENmTWFuYWdlckJhY2tlbmRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWdhdGV3YXkuUmVzdEFwaTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ2ZNYW5hZ2VyQmFja2VuZFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIEFQSSBHYXRld2F5IHdpdGggQ29nbml0byBhdXRob3JpemVyXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdDZk1hbmFnZXJBcGknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgTWFuYWdlciBBUEknLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcbiAgICAgICAgICAnWC1BcGktS2V5JyxcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nXG4gICAgICAgIF0sXG4gICAgICAgIG1heEFnZTogY2RrLkR1cmF0aW9uLmRheXMoMSlcbiAgICAgIH0sXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ2FwaScsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDb2duaXRvIGF1dGhvcml6ZXJcbiAgICBjb25zdCBhdXRob3JpemVyID0gbmV3IGFwaWdhdGV3YXkuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NmTWFuYWdlckF1dGhvcml6ZXInLCB7XG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbcHJvcHMudXNlclBvb2xdLFxuICAgICAgaWRlbnRpdHlTb3VyY2U6ICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbidcbiAgICB9KTtcblxuICAgIC8vIENvbW1vbiBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgY29uc3QgbGFtYmRhRW52ID0ge1xuICAgICAgRElTVFJJQlVUSU9OU19UQUJMRTogcHJvcHMuZGlzdHJpYnV0aW9uc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIFRFTVBMQVRFU19UQUJMRTogcHJvcHMudGVtcGxhdGVzVGFibGUudGFibGVOYW1lLFxuICAgICAgSElTVE9SWV9UQUJMRTogcHJvcHMuaGlzdG9yeVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIE9SSUdJTlNfVEFCTEU6IHByb3BzLm9yaWdpbnNUYWJsZS50YWJsZU5hbWUsXG4gICAgfTtcblxuICAgIC8vIExhbWJkYSBleGVjdXRpb24gcm9sZVxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xhbWJkYVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKVxuICAgICAgXVxuICAgIH0pO1xuXG4gICAgLy8gQWRkIENsb3VkRnJvbnQgcGVybWlzc2lvbnNcbiAgICBsYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2Nsb3VkZnJvbnQ6R2V0KicsXG4gICAgICAgICdjbG91ZGZyb250Okxpc3QqJyxcbiAgICAgICAgJ2Nsb3VkZnJvbnQ6Q3JlYXRlKicsXG4gICAgICAgICdjbG91ZGZyb250OlVwZGF0ZSonLFxuICAgICAgICAnY2xvdWRmcm9udDpEZWxldGUqJyxcbiAgICAgICAgJ2Nsb3VkZnJvbnQ6VGFnUmVzb3VyY2UnLFxuICAgICAgICAnY2xvdWRmcm9udDpVbnRhZ1Jlc291cmNlJyxcbiAgICAgICAgJ2Nsb3VkZnJvbnQ6Q3JlYXRlSW52YWxpZGF0aW9uJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgUzMgcGVybWlzc2lvbnMgZm9yIE9yaWdpbnMgbWFuYWdlbWVudFxuICAgIGxhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnczM6Q3JlYXRlQnVja2V0JyxcbiAgICAgICAgJ3MzOkRlbGV0ZUJ1Y2tldCcsXG4gICAgICAgICdzMzpMaXN0QnVja2V0JyxcbiAgICAgICAgJ3MzOkdldEJ1Y2tldExvY2F0aW9uJyxcbiAgICAgICAgJ3MzOkdldEJ1Y2tldFBvbGljeScsXG4gICAgICAgICdzMzpQdXRCdWNrZXRQb2xpY3knLFxuICAgICAgICAnczM6RGVsZXRlQnVja2V0UG9saWN5JyxcbiAgICAgICAgJ3MzOlB1dEJ1Y2tldFdlYnNpdGUnLFxuICAgICAgICAnczM6RGVsZXRlQnVja2V0V2Vic2l0ZScsXG4gICAgICAgICdzMzpHZXRCdWNrZXRXZWJzaXRlJyxcbiAgICAgICAgJ3MzOlB1dEJ1Y2tldENPUlMnLFxuICAgICAgICAnczM6R2V0QnVja2V0Q09SUycsXG4gICAgICAgICdzMzpEZWxldGVCdWNrZXRDT1JTJyxcbiAgICAgICAgJ3MzOkdldE9iamVjdCcsXG4gICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgICAnczM6RGVsZXRlT2JqZWN0JyxcbiAgICAgICAgJ3MzOkxpc3RPYmplY3RzJyxcbiAgICAgICAgJ3MzOkxpc3RPYmplY3RzVjInXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBMYW1iZGEgaW52b2tlIHBlcm1pc3Npb25zIHRvIHRoZSByb2xlXG4gICAgbGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsYW1iZGE6SW52b2tlRnVuY3Rpb24nXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXG4gICAgcHJvcHMuZGlzdHJpYnV0aW9uc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFSb2xlKTtcbiAgICBwcm9wcy50ZW1wbGF0ZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEobGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuaGlzdG9yeVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5vcmlnaW5zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYVJvbGUpOyAgLy8gQWRkIHBlcm1pc3Npb25zIGZvciBPcmlnaW5zIHRhYmxlXG5cbiAgICAvLyBEZWZpbmUgU3RlcCBGdW5jdGlvbiBMYW1iZGEgZnVuY3Rpb25zIGZpcnN0XG4gICAgY29uc3QgY2hlY2tEZXBsb3ltZW50U3RhdHVzID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ2hlY2tEZXBsb3ltZW50U3RhdHVzRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL2NvbW1vbi9jaGVja0RlcGxveW1lbnRTdGF0dXMnLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLCBbXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCcsXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiIEBhd3Mtc2RrL2NsaWVudC1jbG91ZGZyb250JyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL2NvbW1vbi9jaGVja0RlcGxveW1lbnRTdGF0dXMgJiYgbnBtIGluc3RhbGwgJiYgbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiBAYXdzLXNkay9jbGllbnQtY2xvdWRmcm9udCAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdDaGVja3MgdGhlIGRlcGxveW1lbnQgc3RhdHVzIG9mIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nXG4gICAgfSk7XG5cbiAgICBjb25zdCB1cGRhdGVEaXN0cmlidXRpb25TdGF0dXMgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdVcGRhdGVEaXN0cmlidXRpb25TdGF0dXNGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvY29tbW9uL3VwZGF0ZURpc3RyaWJ1dGlvblN0YXR1cycsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGInLFxuICAgICAgICAgICAgICAnY3AgLXIgL2Fzc2V0LWlucHV0LyogL2Fzc2V0LW91dHB1dC8nLFxuICAgICAgICAgICAgICAnY3AgLXIgbm9kZV9tb2R1bGVzIC9hc3NldC1vdXRwdXQvJ1xuICAgICAgICAgICAgXS5qb2luKCcgJiYgJylcbiAgICAgICAgICBdLFxuICAgICAgICAgIGxvY2FsOiB7XG4gICAgICAgICAgICB0cnlCdW5kbGUob3V0cHV0RGlyOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKFxuICAgICAgICAgICAgICAgIGBjZCBmdW5jdGlvbnMvY29tbW9uL3VwZGF0ZURpc3RyaWJ1dGlvblN0YXR1cyAmJiBucG0gaW5zdGFsbCAmJiBucG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiICYmIG1rZGlyIC1wICR7b3V0cHV0RGlyfSAmJiBjcCAtciAqICR7b3V0cHV0RGlyfSAmJiBjcCAtciBub2RlX21vZHVsZXMgJHtvdXRwdXREaXJ9YCxcbiAgICAgICAgICAgICAgICB7IHN0ZGlvOiAnaW5oZXJpdCcgfVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudixcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VwZGF0ZXMgdGhlIHN0YXR1cyBvZiBhIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIGluIER5bmFtb0RCJ1xuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIFN0ZXAgRnVuY3Rpb25cbiAgICBjb25zdCBjaGVja1N0YXR1cyA9IG5ldyB0YXNrcy5MYW1iZGFJbnZva2UodGhpcywgJ0NoZWNrIERlcGxveW1lbnQgU3RhdHVzJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IGNoZWNrRGVwbG95bWVudFN0YXR1cyxcbiAgICAgIG91dHB1dFBhdGg6ICckLlBheWxvYWQnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdXBkYXRlU3RhdHVzID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnVXBkYXRlIERpc3RyaWJ1dGlvbiBTdGF0dXMnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogdXBkYXRlRGlzdHJpYnV0aW9uU3RhdHVzLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCB3YWl0MzBTZWNvbmRzID0gbmV3IHNmbi5XYWl0KHRoaXMsICdXYWl0IDMwIFNlY29uZHMnLCB7XG4gICAgICB0aW1lOiBzZm4uV2FpdFRpbWUuZHVyYXRpb24oY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGlzRGVwbG95ZWQgPSBuZXcgc2ZuLkNob2ljZSh0aGlzLCAnSXMgRGVwbG95ZWQ/Jyk7XG4gICAgY29uc3QgZGVwbG95bWVudENvbXBsZXRlID0gbmV3IHNmbi5TdWNjZWVkKHRoaXMsICdEZXBsb3ltZW50IENvbXBsZXRlJyk7XG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gY2hlY2tTdGF0dXNcbiAgICAgIC5uZXh0KGlzRGVwbG95ZWRcbiAgICAgICAgLndoZW4oc2ZuLkNvbmRpdGlvbi5zdHJpbmdFcXVhbHMoJyQuc3RhdHVzJywgJ0RlcGxveWVkJyksIHVwZGF0ZVN0YXR1cylcbiAgICAgICAgLndoZW4oc2ZuLkNvbmRpdGlvbi5zdHJpbmdFcXVhbHMoJyQuc3RhdHVzJywgJ0luUHJvZ3Jlc3MnKSwgd2FpdDMwU2Vjb25kcy5uZXh0KGNoZWNrU3RhdHVzKSlcbiAgICAgICAgLm90aGVyd2lzZSh1cGRhdGVTdGF0dXMpXG4gICAgICApO1xuXG4gICAgdXBkYXRlU3RhdHVzLm5leHQoZGVwbG95bWVudENvbXBsZXRlKTtcblxuICAgIC8vIENyZWF0ZSB0aGUgc3RhdGUgbWFjaGluZSBiZWZvcmUgdGhlIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBuZWVkIGl0XG4gICAgY29uc3QgZGVwbG95bWVudFN0YXRlTWFjaGluZSA9IG5ldyBzZm4uU3RhdGVNYWNoaW5lKHRoaXMsICdEZXBsb3ltZW50U3RhdGVNYWNoaW5lJywge1xuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5ob3VycygyKSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdEZXBsb3ltZW50U3RhdGVNYWNoaW5lTG9ncycsIHtcbiAgICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgIH0pLFxuICAgICAgICBsZXZlbDogc2ZuLkxvZ0xldmVsLkFMTFxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbnMgZm9yIGRpc3RyaWJ1dGlvbnNcbiAgICBjb25zdCBsaXN0RGlzdHJpYnV0aW9uc0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTGlzdERpc3RyaWJ1dGlvbnNGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9saXN0JyksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGlzdHMgQ2xvdWRGcm9udCBkaXN0cmlidXRpb25zJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0RGlzdHJpYnV0aW9uRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdHZXREaXN0cmlidXRpb25GdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9nZXQnKSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdHZXRzIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIG1haW4gZGlzdHJpYnV0aW9uIGZ1bmN0aW9uIHdpdGggQVdTIFNESyB2M1xuICAgIGNvbnN0IGNyZWF0ZURpc3RyaWJ1dGlvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ3JlYXRlRGlzdHJpYnV0aW9uRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL2Rpc3RyaWJ1dGlvbnMvY3JlYXRlJywge1xuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGltYWdlOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWC5idW5kbGluZ0ltYWdlLFxuICAgICAgICAgIGNvbW1hbmQ6IFtcbiAgICAgICAgICAgICdiYXNoJywgJy1jJywgW1xuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwnLFxuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiBAYXdzLXNkay9jbGllbnQtY2xvdWRmcm9udCBAYXdzLXNkay9jbGllbnQtc2ZuJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL2Rpc3RyaWJ1dGlvbnMvY3JlYXRlICYmIG5wbSBpbnN0YWxsICYmIG5wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgQGF3cy1zZGsvY2xpZW50LWNsb3VkZnJvbnQgQGF3cy1zZGsvY2xpZW50LXNmbiAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC4uLmxhbWJkYUVudixcbiAgICAgICAgQVdTX0FDQ09VTlRfSUQ6IHRoaXMuYWNjb3VudCxcbiAgICAgICAgREVQTE9ZTUVOVF9TVEFURV9NQUNISU5FX0FSTjogZGVwbG95bWVudFN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm5cbiAgICAgIH0sXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdDcmVhdGVzIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIHByb3h5IGZ1bmN0aW9uIGZvciBoYW5kbGluZyBDT1JTIGFuZCBpbnZva2luZyB0aGUgbWFpbiBmdW5jdGlvblxuICAgIGNvbnN0IGNyZWF0ZURpc3RyaWJ1dGlvblByb3h5RnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDcmVhdGVEaXN0cmlidXRpb25Qcm94eUZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy9kaXN0cmlidXRpb25zL2NyZWF0ZS1wcm94eScsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1sYW1iZGEnLFxuICAgICAgICAgICAgICAnY3AgLXIgL2Fzc2V0LWlucHV0LyogL2Fzc2V0LW91dHB1dC8nLFxuICAgICAgICAgICAgICAnY3AgLXIgbm9kZV9tb2R1bGVzIC9hc3NldC1vdXRwdXQvJ1xuICAgICAgICAgICAgXS5qb2luKCcgJiYgJylcbiAgICAgICAgICBdLFxuICAgICAgICAgIGxvY2FsOiB7XG4gICAgICAgICAgICB0cnlCdW5kbGUob3V0cHV0RGlyOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKFxuICAgICAgICAgICAgICAgIGBjZCBmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9jcmVhdGUtcHJveHkgJiYgbnBtIGluc3RhbGwgJiYgbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWxhbWJkYSAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFRBUkdFVF9GVU5DVElPTl9OQU1FOiBjcmVhdGVEaXN0cmlidXRpb25GdW5jdGlvbi5mdW5jdGlvbk5hbWVcbiAgICAgIH0sXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdQcm94eSBmb3IgY3JlYXRpbmcgQ2xvdWRGcm9udCBkaXN0cmlidXRpb25zIHdpdGggcHJvcGVyIENPUlMgaGFuZGxpbmcnXG4gICAgfSk7XG5cbiAgICBjb25zdCB1cGRhdGVEaXN0cmlidXRpb25GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1VwZGF0ZURpc3RyaWJ1dGlvbkZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy9kaXN0cmlidXRpb25zL3VwZGF0ZScpLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudixcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VwZGF0ZXMgYSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbidcbiAgICB9KTtcblxuICAgIGNvbnN0IGRlbGV0ZURpc3RyaWJ1dGlvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRGVsZXRlRGlzdHJpYnV0aW9uRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL2Rpc3RyaWJ1dGlvbnMvZGVsZXRlJyksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVsZXRlcyBhIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0RGlzdHJpYnV0aW9uU3RhdHVzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdHZXREaXN0cmlidXRpb25TdGF0dXNGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9nZXRTdGF0dXMnKSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdHZXRzIHRoZSBzdGF0dXMgb2YgYSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbidcbiAgICB9KTtcblxuICAgIGNvbnN0IGludmFsaWRhdGVEaXN0cmlidXRpb25GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0ludmFsaWRhdGVEaXN0cmlidXRpb25GdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9pbnZhbGlkYXRlJyksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3JlYXRlcyBhbiBpbnZhbGlkYXRpb24gZm9yIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24nXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9ucyBmb3Igb3JpZ2luc1xuICAgIGNvbnN0IGxpc3RPcmlnaW5zRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdMaXN0T3JpZ2luc0Z1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy9vcmlnaW5zL2xpc3QnKSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsICAvLyBsYW1iZGFFbnYgbm93IGluY2x1ZGVzIE9SSUdJTlNfVEFCTEVcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0xpc3RzIFMzIG9yaWdpbnMgZm9yIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9ucydcbiAgICB9KTtcblxuICAgIGNvbnN0IGdldE9yaWdpbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnR2V0T3JpZ2luRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL29yaWdpbnMvZ2V0JyksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LCAgLy8gbGFtYmRhRW52IG5vdyBpbmNsdWRlcyBPUklHSU5TX1RBQkxFXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdHZXRzIGFuIFMzIG9yaWdpbiBmb3IgQ2xvdWRGcm9udCBkaXN0cmlidXRpb25zJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgY3JlYXRlT3JpZ2luRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdDcmVhdGVPcmlnaW5GdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvb3JpZ2lucy9jcmVhdGUnLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLCBbXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCcsXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiIEBhd3Mtc2RrL2NsaWVudC1zMycsXG4gICAgICAgICAgICAgICdjcCAtciAvYXNzZXQtaW5wdXQvKiAvYXNzZXQtb3V0cHV0LycsXG4gICAgICAgICAgICAgICdjcCAtciBub2RlX21vZHVsZXMgL2Fzc2V0LW91dHB1dC8nXG4gICAgICAgICAgICBdLmpvaW4oJyAmJiAnKVxuICAgICAgICAgIF0sXG4gICAgICAgICAgbG9jYWw6IHtcbiAgICAgICAgICAgIHRyeUJ1bmRsZShvdXRwdXREaXI6IHN0cmluZykge1xuICAgICAgICAgICAgICByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJykuZXhlY1N5bmMoXG4gICAgICAgICAgICAgICAgYGNkIGZ1bmN0aW9ucy9vcmlnaW5zL2NyZWF0ZSAmJiBucG0gaW5zdGFsbCAmJiBucG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiIEBhd3Mtc2RrL2NsaWVudC1zMyAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsICAvLyBsYW1iZGFFbnYgbm93IGluY2x1ZGVzIE9SSUdJTlNfVEFCTEVcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NyZWF0ZXMgYW4gUzMgb3JpZ2luIGZvciBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbnMnXG4gICAgfSk7XG5cbiAgICBjb25zdCB1cGRhdGVPcmlnaW5GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1VwZGF0ZU9yaWdpbkZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy9vcmlnaW5zL3VwZGF0ZScsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgQGF3cy1zZGsvY2xpZW50LXMzJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL29yaWdpbnMvdXBkYXRlICYmIG5wbSBpbnN0YWxsICYmIG5wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgQGF3cy1zZGsvY2xpZW50LXMzICYmIG1rZGlyIC1wICR7b3V0cHV0RGlyfSAmJiBjcCAtciAqICR7b3V0cHV0RGlyfSAmJiBjcCAtciBub2RlX21vZHVsZXMgJHtvdXRwdXREaXJ9YCxcbiAgICAgICAgICAgICAgICB7IHN0ZGlvOiAnaW5oZXJpdCcgfVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudiwgIC8vIGxhbWJkYUVudiBub3cgaW5jbHVkZXMgT1JJR0lOU19UQUJMRVxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXBkYXRlcyBhbiBTMyBvcmlnaW4gZm9yIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9ucydcbiAgICB9KTtcblxuICAgIGNvbnN0IGRlbGV0ZU9yaWdpbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRGVsZXRlT3JpZ2luRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL29yaWdpbnMvZGVsZXRlJywge1xuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGltYWdlOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWC5idW5kbGluZ0ltYWdlLFxuICAgICAgICAgIGNvbW1hbmQ6IFtcbiAgICAgICAgICAgICdiYXNoJywgJy1jJywgW1xuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwnLFxuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiBAYXdzLXNkay9jbGllbnQtczMnLFxuICAgICAgICAgICAgICAnY3AgLXIgL2Fzc2V0LWlucHV0LyogL2Fzc2V0LW91dHB1dC8nLFxuICAgICAgICAgICAgICAnY3AgLXIgbm9kZV9tb2R1bGVzIC9hc3NldC1vdXRwdXQvJ1xuICAgICAgICAgICAgXS5qb2luKCcgJiYgJylcbiAgICAgICAgICBdLFxuICAgICAgICAgIGxvY2FsOiB7XG4gICAgICAgICAgICB0cnlCdW5kbGUob3V0cHV0RGlyOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKFxuICAgICAgICAgICAgICAgIGBjZCBmdW5jdGlvbnMvb3JpZ2lucy9kZWxldGUgJiYgbnBtIGluc3RhbGwgJiYgbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiBAYXdzLXNkay9jbGllbnQtczMgJiYgbWtkaXIgLXAgJHtvdXRwdXREaXJ9ICYmIGNwIC1yICogJHtvdXRwdXREaXJ9ICYmIGNwIC1yIG5vZGVfbW9kdWxlcyAke291dHB1dERpcn1gLFxuICAgICAgICAgICAgICAgIHsgc3RkaW86ICdpbmhlcml0JyB9XG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LCAgLy8gbGFtYmRhRW52IG5vdyBpbmNsdWRlcyBPUklHSU5TX1RBQkxFXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdEZWxldGVzIGFuIFMzIG9yaWdpbiBmb3IgQ2xvdWRGcm9udCBkaXN0cmlidXRpb25zJ1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbnMgZm9yIHRlbXBsYXRlc1xuICAgIGNvbnN0IGxpc3RUZW1wbGF0ZXNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0xpc3RUZW1wbGF0ZXNGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvdGVtcGxhdGVzL2xpc3QnLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLCBbXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCcsXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL3RlbXBsYXRlcy9saXN0ICYmIG5wbSBpbnN0YWxsICYmIG5wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgJiYgbWtkaXIgLXAgJHtvdXRwdXREaXJ9ICYmIGNwIC1yICogJHtvdXRwdXREaXJ9ICYmIGNwIC1yIG5vZGVfbW9kdWxlcyAke291dHB1dERpcn1gLFxuICAgICAgICAgICAgICAgIHsgc3RkaW86ICdpbmhlcml0JyB9XG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDogbGFtYmRhRW52LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGlzdHMgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdGVtcGxhdGVzJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgZ2V0VGVtcGxhdGVGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0dldFRlbXBsYXRlRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL3RlbXBsYXRlcy9nZXQnLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLCBbXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCcsXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL3RlbXBsYXRlcy9nZXQgJiYgbnBtIGluc3RhbGwgJiYgbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdHZXRzIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdGVtcGxhdGUnXG4gICAgfSk7XG5cbiAgICBjb25zdCBjcmVhdGVUZW1wbGF0ZUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnQ3JlYXRlVGVtcGxhdGVGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvdGVtcGxhdGVzL2NyZWF0ZScsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgdXVpZCcsXG4gICAgICAgICAgICAgICdjcCAtciAvYXNzZXQtaW5wdXQvKiAvYXNzZXQtb3V0cHV0LycsXG4gICAgICAgICAgICAgICdjcCAtciBub2RlX21vZHVsZXMgL2Fzc2V0LW91dHB1dC8nXG4gICAgICAgICAgICBdLmpvaW4oJyAmJiAnKVxuICAgICAgICAgIF0sXG4gICAgICAgICAgbG9jYWw6IHtcbiAgICAgICAgICAgIHRyeUJ1bmRsZShvdXRwdXREaXI6IHN0cmluZykge1xuICAgICAgICAgICAgICByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJykuZXhlY1N5bmMoXG4gICAgICAgICAgICAgICAgYGNkIGZ1bmN0aW9ucy90ZW1wbGF0ZXMvY3JlYXRlICYmIG5wbSBpbnN0YWxsICYmIG5wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGIgdXVpZCAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdDcmVhdGVzIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdGVtcGxhdGUnXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIHByb3h5IGZ1bmN0aW9uIGZvciBoYW5kbGluZyBDT1JTIGFuZCBpbnZva2luZyB0aGUgbWFpbiBmdW5jdGlvblxuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlUHJveHlGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NyZWF0ZVRlbXBsYXRlUHJveHlGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvdGVtcGxhdGVzL2NyZWF0ZS1wcm94eScsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1sYW1iZGEnLFxuICAgICAgICAgICAgICAnY3AgLXIgL2Fzc2V0LWlucHV0LyogL2Fzc2V0LW91dHB1dC8nLFxuICAgICAgICAgICAgICAnY3AgLXIgbm9kZV9tb2R1bGVzIC9hc3NldC1vdXRwdXQvJ1xuICAgICAgICAgICAgXS5qb2luKCcgJiYgJylcbiAgICAgICAgICBdLFxuICAgICAgICAgIGxvY2FsOiB7XG4gICAgICAgICAgICB0cnlCdW5kbGUob3V0cHV0RGlyOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKFxuICAgICAgICAgICAgICAgIGBjZCBmdW5jdGlvbnMvdGVtcGxhdGVzL2NyZWF0ZS1wcm94eSAmJiBucG0gaW5zdGFsbCAmJiBucG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtbGFtYmRhICYmIG1rZGlyIC1wICR7b3V0cHV0RGlyfSAmJiBjcCAtciAqICR7b3V0cHV0RGlyfSAmJiBjcCAtciBub2RlX21vZHVsZXMgJHtvdXRwdXREaXJ9YCxcbiAgICAgICAgICAgICAgICB7IHN0ZGlvOiAnaW5oZXJpdCcgfVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVEFSR0VUX0ZVTkNUSU9OX05BTUU6IGNyZWF0ZVRlbXBsYXRlRnVuY3Rpb24uZnVuY3Rpb25OYW1lXG4gICAgICB9LFxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJveHkgZm9yIGNyZWF0aW5nIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHRlbXBsYXRlcyB3aXRoIHByb3BlciBDT1JTIGhhbmRsaW5nJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgdXBkYXRlVGVtcGxhdGVGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1VwZGF0ZVRlbXBsYXRlRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL3RlbXBsYXRlcy91cGRhdGUnLCB7XG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgaW1hZ2U6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLmJ1bmRsaW5nSW1hZ2UsXG4gICAgICAgICAgY29tbWFuZDogW1xuICAgICAgICAgICAgJ2Jhc2gnLCAnLWMnLCBbXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCcsXG4gICAgICAgICAgICAgICducG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL3RlbXBsYXRlcy91cGRhdGUgJiYgbnBtIGluc3RhbGwgJiYgbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiAmJiBta2RpciAtcCAke291dHB1dERpcn0gJiYgY3AgLXIgKiAke291dHB1dERpcn0gJiYgY3AgLXIgbm9kZV9tb2R1bGVzICR7b3V0cHV0RGlyfWAsXG4gICAgICAgICAgICAgICAgeyBzdGRpbzogJ2luaGVyaXQnIH1cbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KSxcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZGVzY3JpcHRpb246ICdVcGRhdGVzIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gdGVtcGxhdGUnXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZWxldGVUZW1wbGF0ZUZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRGVsZXRlVGVtcGxhdGVGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvdGVtcGxhdGVzL2RlbGV0ZScsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBpbWFnZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1guYnVuZGxpbmdJbWFnZSxcbiAgICAgICAgICBjb21tYW5kOiBbXG4gICAgICAgICAgICAnYmFzaCcsICctYycsIFtcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsJyxcbiAgICAgICAgICAgICAgJ25wbSBpbnN0YWxsIEBhd3Mtc2RrL2NsaWVudC1keW5hbW9kYiBAYXdzLXNkay9saWItZHluYW1vZGInLFxuICAgICAgICAgICAgICAnY3AgLXIgL2Fzc2V0LWlucHV0LyogL2Fzc2V0LW91dHB1dC8nLFxuICAgICAgICAgICAgICAnY3AgLXIgbm9kZV9tb2R1bGVzIC9hc3NldC1vdXRwdXQvJ1xuICAgICAgICAgICAgXS5qb2luKCcgJiYgJylcbiAgICAgICAgICBdLFxuICAgICAgICAgIGxvY2FsOiB7XG4gICAgICAgICAgICB0cnlCdW5kbGUob3V0cHV0RGlyOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKFxuICAgICAgICAgICAgICAgIGBjZCBmdW5jdGlvbnMvdGVtcGxhdGVzL2RlbGV0ZSAmJiBucG0gaW5zdGFsbCAmJiBucG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiICYmIG1rZGlyIC1wICR7b3V0cHV0RGlyfSAmJiBjcCAtciAqICR7b3V0cHV0RGlyfSAmJiBjcCAtciBub2RlX21vZHVsZXMgJHtvdXRwdXREaXJ9YCxcbiAgICAgICAgICAgICAgICB7IHN0ZGlvOiAnaW5oZXJpdCcgfVxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudixcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RlbGV0ZXMgYSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiB0ZW1wbGF0ZSdcbiAgICB9KTtcblxuICAgIGNvbnN0IGFwcGx5VGVtcGxhdGVGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FwcGx5VGVtcGxhdGVGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvdGVtcGxhdGVzL2FwcGx5Jywge1xuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGltYWdlOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWC5idW5kbGluZ0ltYWdlLFxuICAgICAgICAgIGNvbW1hbmQ6IFtcbiAgICAgICAgICAgICdiYXNoJywgJy1jJywgW1xuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwnLFxuICAgICAgICAgICAgICAnbnBtIGluc3RhbGwgQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiIEBhd3Mtc2RrL2xpYi1keW5hbW9kYiBAYXdzLXNkay9jbGllbnQtbGFtYmRhJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIC9hc3NldC1pbnB1dC8qIC9hc3NldC1vdXRwdXQvJyxcbiAgICAgICAgICAgICAgJ2NwIC1yIG5vZGVfbW9kdWxlcyAvYXNzZXQtb3V0cHV0LydcbiAgICAgICAgICAgIF0uam9pbignICYmICcpXG4gICAgICAgICAgXSxcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYyhcbiAgICAgICAgICAgICAgICBgY2QgZnVuY3Rpb25zL3RlbXBsYXRlcy9hcHBseSAmJiBucG0gaW5zdGFsbCAmJiBucG0gaW5zdGFsbCBAYXdzLXNkay9jbGllbnQtZHluYW1vZGIgQGF3cy1zZGsvbGliLWR5bmFtb2RiIEBhd3Mtc2RrL2NsaWVudC1sYW1iZGEgJiYgbWtkaXIgLXAgJHtvdXRwdXREaXJ9ICYmIGNwIC1yICogJHtvdXRwdXREaXJ9ICYmIGNwIC1yIG5vZGVfbW9kdWxlcyAke291dHB1dERpcn1gLFxuICAgICAgICAgICAgICAgIHsgc3RkaW86ICdpbmhlcml0JyB9XG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAuLi5sYW1iZGFFbnYsXG4gICAgICAgIENSRUFURV9ESVNUUklCVVRJT05fRlVOQ1RJT046IGNyZWF0ZURpc3RyaWJ1dGlvbkZ1bmN0aW9uLmZ1bmN0aW9uTmFtZVxuICAgICAgfSxcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcGxpZXMgYSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiB0ZW1wbGF0ZSdcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBUEkgcmVzb3VyY2VzIGFuZCBtZXRob2RzXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uc1Jlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgnZGlzdHJpYnV0aW9ucycpO1xuICAgIGNvbnN0IGRpc3RyaWJ1dGlvblJlc291cmNlID0gZGlzdHJpYnV0aW9uc1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgY29uc3QgZGlzdHJpYnV0aW9uU3RhdHVzUmVzb3VyY2UgPSBkaXN0cmlidXRpb25SZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhdHVzJyk7XG4gICAgY29uc3QgZGlzdHJpYnV0aW9uSW52YWxpZGF0ZVJlc291cmNlID0gZGlzdHJpYnV0aW9uUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2ludmFsaWRhdGUnKTtcblxuICAgIGNvbnN0IHRlbXBsYXRlc1Jlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgndGVtcGxhdGVzJyk7XG4gICAgY29uc3QgdGVtcGxhdGVSZXNvdXJjZSA9IHRlbXBsYXRlc1Jlc291cmNlLmFkZFJlc291cmNlKCd7aWR9Jyk7XG4gICAgY29uc3QgdGVtcGxhdGVBcHBseVJlc291cmNlID0gdGVtcGxhdGVSZXNvdXJjZS5hZGRSZXNvdXJjZSgnYXBwbHknKTtcblxuICAgIC8vIENvbmZpZ3VyZSBBUEkgbWV0aG9kcyBmb3IgZGlzdHJpYnV0aW9uc1xuICAgIGRpc3RyaWJ1dGlvbnNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGxpc3REaXN0cmlidXRpb25zRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgLy8gVXNlIHRoZSBwcm94eSBmdW5jdGlvbiBmb3IgUE9TVCBtZXRob2QgdG8gaGFuZGxlIENPUlMgcHJvcGVybHlcbiAgICBkaXN0cmlidXRpb25zUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oY3JlYXRlRGlzdHJpYnV0aW9uUHJveHlGdW5jdGlvbiksIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG5cbiAgICBkaXN0cmlidXRpb25SZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldERpc3RyaWJ1dGlvbkZ1bmN0aW9uKSwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcblxuICAgIGRpc3RyaWJ1dGlvblJlc291cmNlLmFkZE1ldGhvZCgnUFVUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odXBkYXRlRGlzdHJpYnV0aW9uRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgZGlzdHJpYnV0aW9uUmVzb3VyY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihkZWxldGVEaXN0cmlidXRpb25GdW5jdGlvbiksIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG5cbiAgICBkaXN0cmlidXRpb25TdGF0dXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldERpc3RyaWJ1dGlvblN0YXR1c0Z1bmN0aW9uKSwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcblxuICAgIGRpc3RyaWJ1dGlvbkludmFsaWRhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihpbnZhbGlkYXRlRGlzdHJpYnV0aW9uRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuICAgIFxuICAgIC8vIENvbmZpZ3VyZSBBUEkgbWV0aG9kcyBmb3IgdGVtcGxhdGVzXG4gICAgdGVtcGxhdGVzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihsaXN0VGVtcGxhdGVzRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgLy8gVXNlIHRoZSBwcm94eSBmdW5jdGlvbiBmb3IgUE9TVCBtZXRob2QgdG8gaGFuZGxlIENPUlMgcHJvcGVybHlcbiAgICB0ZW1wbGF0ZXNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihjcmVhdGVUZW1wbGF0ZVByb3h5RnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgdGVtcGxhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGdldFRlbXBsYXRlRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgdGVtcGxhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BVVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHVwZGF0ZVRlbXBsYXRlRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgdGVtcGxhdGVSZXNvdXJjZS5hZGRNZXRob2QoJ0RFTEVURScsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGRlbGV0ZVRlbXBsYXRlRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgdGVtcGxhdGVBcHBseVJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFwcGx5VGVtcGxhdGVGdW5jdGlvbiksIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQVBJIHJlc291cmNlcyBhbmQgbWV0aG9kcyBmb3Igb3JpZ2luc1xuICAgIGNvbnN0IG9yaWdpbnNSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ29yaWdpbnMnKTtcbiAgICBjb25zdCBvcmlnaW5SZXNvdXJjZSA9IG9yaWdpbnNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne2lkfScpO1xuXG4gICAgLy8gQ29uZmlndXJlIEFQSSBtZXRob2RzIGZvciBvcmlnaW5zXG4gICAgb3JpZ2luc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24obGlzdE9yaWdpbnNGdW5jdGlvbiksIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG5cbiAgICBvcmlnaW5zUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oY3JlYXRlT3JpZ2luRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgb3JpZ2luUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihnZXRPcmlnaW5GdW5jdGlvbiksIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPXG4gICAgfSk7XG5cbiAgICBvcmlnaW5SZXNvdXJjZS5hZGRNZXRob2QoJ1BVVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHVwZGF0ZU9yaWdpbkZ1bmN0aW9uKSwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE9cbiAgICB9KTtcblxuICAgIG9yaWdpblJlc291cmNlLmFkZE1ldGhvZCgnREVMRVRFJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZGVsZXRlT3JpZ2luRnVuY3Rpb24pLCB7XG4gICAgICBhdXRob3JpemVyLFxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUT1xuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlFbmRwb2ludCcsIHsgXG4gICAgICB2YWx1ZTogdGhpcy5hcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBFbmRwb2ludCBVUkwnXG4gICAgfSk7XG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RlcGxveW1lbnRTdGF0ZU1hY2hpbmVBcm4nLCB7IFxuICAgICAgdmFsdWU6IGRlcGxveW1lbnRTdGF0ZU1hY2hpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdEZXBsb3ltZW50IFN0YXRlIE1hY2hpbmUgQVJOJ1xuICAgIH0pO1xuICB9XG59XG4iXX0=