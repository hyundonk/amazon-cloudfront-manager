import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

interface CfManagerBackendStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  distributionsTable: dynamodb.Table;
  templatesTable: dynamodb.Table;
  historyTable: dynamodb.Table;
  originsTable: dynamodb.Table;
}

export class CfManagerBackendStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: CfManagerBackendStackProps) {
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
        'cloudfront:CreateInvalidation',
        // Explicit OAC permissions
        'cloudfront:CreateOriginAccessControl',
        'cloudfront:DeleteOriginAccessControl',
        'cloudfront:GetOriginAccessControl',
        'cloudfront:ListOriginAccessControls'
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
    props.originsTable.grantReadWriteData(lambdaRole);  // Add permissions for Origins table

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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/common/checkDeploymentStatus && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/common/updateDistributionStatus && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
        .otherwise(updateStatus)
      );

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
              'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-sfn @aws-sdk/client-s3',
              'cp -r /asset-input/* /asset-output/',
              'cp -r node_modules /asset-output/'
            ].join(' && ')
          ],
          local: {
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/distributions/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-sfn @aws-sdk/client-s3 && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
      timeout: cdk.Duration.seconds(60), // Increased timeout for CloudFront operations
      memorySize: 512, // Increased memory for better performance
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/distributions/create-proxy && npm install && npm install @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
      environment: lambdaEnv,  // lambdaEnv now includes ORIGINS_TABLE
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Lists S3 origins for CloudFront distributions'
    });

    const getOriginFunction = new lambda.Function(this, 'GetOriginFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/origins/get'),
      environment: lambdaEnv,  // lambdaEnv now includes ORIGINS_TABLE
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/origins/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 @aws-sdk/client-cloudfront && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
              return true;
            }
          }
        }
      }),
      environment: lambdaEnv,  // lambdaEnv now includes ORIGINS_TABLE
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/origins/update && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
              return true;
            }
          }
        }
      }),
      environment: lambdaEnv,  // lambdaEnv now includes ORIGINS_TABLE
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/origins/delete && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 @aws-sdk/client-cloudfront && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
              return true;
            }
          }
        }
      }),
      environment: lambdaEnv,  // lambdaEnv now includes ORIGINS_TABLE
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/list && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/get && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/create && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb uuid && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/create-proxy && npm install && npm install @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/update && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/delete && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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
            tryBundle(outputDir: string) {
              require('child_process').execSync(
                `cd functions/templates/apply && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-lambda && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                { stdio: 'inherit' }
              );
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

    // Certificate management Lambda functions
    const listCertificatesFunction = new lambda.Function(this, 'ListCertificatesFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/certificates/list'),
      environment: lambdaEnv,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Lists available SSL certificates from ACM'
    });

    const getCertificateFunction = new lambda.Function(this, 'GetCertificateFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/certificates/get'),
      environment: lambdaEnv,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Gets detailed information about a specific SSL certificate'
    });

    // Add ACM permissions to Lambda role
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'acm:ListCertificates',
        'acm:DescribeCertificate'
      ],
      resources: ['*']
    }));

    // Add Step Functions permissions to Lambda role
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartExecution'
      ],
      resources: ['*']  // Using wildcard to avoid circular dependency
    }));

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

    // Create API resources and methods for certificates
    const certificatesResource = this.api.root.addResource('certificates');
    const certificateResource = certificatesResource.addResource('{arn}');

    // Configure API methods for certificates
    certificatesResource.addMethod('GET', new apigateway.LambdaIntegration(listCertificatesFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    certificateResource.addMethod('GET', new apigateway.LambdaIntegration(getCertificateFunction), {
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
