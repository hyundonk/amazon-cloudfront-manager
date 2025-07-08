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
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as path from 'path';

interface CfManagerBackendStackProps extends cdk.StackProps {
  userPool: cognito.UserPool;
  distributionsTable: dynamodb.Table;
  templatesTable: dynamodb.Table;
  historyTable: dynamodb.Table;
  originsTable: dynamodb.Table;
  lambdaEdgeFunctionsTable: dynamodb.Table;
  customCachePolicy: cloudfront.CachePolicy;
  runtime: 'python' | 'nodejs';
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
      LAMBDA_EDGE_FUNCTIONS_TABLE: props.lambdaEdgeFunctionsTable.tableName,
      CUSTOM_CACHE_POLICY_ID: props.customCachePolicy.cachePolicyId,
    };

    // Lambda execution role with Lambda@Edge support
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
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

    // Add Lambda@Edge function creation permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:CreateFunction',
        'lambda:PublishVersion',
        'lambda:GetFunction',
        'lambda:DeleteFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:TagResource',
        'lambda:UntagResource',
        'lambda:ListTags',
        'lambda:EnableReplication*'
      ],
      resources: [
        'arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*',
        'arn:aws:lambda:*:*:function:*-multi-origin-func-*'
      ]
    }));

    // Add IAM permissions for Lambda@Edge execution role
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'iam:PassRole'
      ],
      resources: [
        lambdaRole.roleArn
      ]
    }));

    // Grant DynamoDB permissions
    props.distributionsTable.grantReadWriteData(lambdaRole);
    props.templatesTable.grantReadWriteData(lambdaRole);
    props.historyTable.grantReadWriteData(lambdaRole);
    props.originsTable.grantReadWriteData(lambdaRole);  // Add permissions for Origins table
    props.lambdaEdgeFunctionsTable.grantReadWriteData(lambdaRole);  // Add permissions for Lambda@Edge Functions table

    // Create Lambda layer for Python common utilities (only if using Python runtime)
    let commonUtilsLayer: lambda.LayerVersion | undefined;
    if (props.runtime === 'python') {
      commonUtilsLayer = new lambda.LayerVersion(this, 'CommonUtilsLayer', {
        code: lambda.Code.fromAsset('functions-python/layers/common-utils'),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
        description: 'Common utilities for CloudFront Manager Python functions',
      });
    }

    // Helper function to create Lambda functions based on runtime
    const createLambdaFunction = (
      id: string,
      functionPath: string,
      description: string,
      timeout: cdk.Duration = cdk.Duration.seconds(30),
      memorySize: number = 256,
      additionalEnv: { [key: string]: string } = {}
    ): lambda.Function => {
      const environment = { ...lambdaEnv, ...additionalEnv };

      if (props.runtime === 'python') {
        return new lambda.Function(this, id, {
          runtime: lambda.Runtime.PYTHON_3_9,
          handler: 'lambda_function.lambda_handler',
          code: lambda.Code.fromAsset(`functions-python/${functionPath}`),
          environment,
          role: lambdaRole,
          timeout,
          memorySize,
          description: `${description} (Python)`,
          layers: commonUtilsLayer ? [commonUtilsLayer] : undefined,
        });
      } else {
        // Node.js runtime with bundling
        return new lambda.Function(this, id, {
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: 'index.handler',
          code: lambda.Code.fromAsset(`functions/${functionPath}`, {
            bundling: {
              image: lambda.Runtime.NODEJS_18_X.bundlingImage,
              command: [
                'bash', '-c', [
                  'npm install',
                  'npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-s3 @aws-sdk/client-lambda @aws-sdk/client-sfn @aws-sdk/client-acm jszip uuid',
                  'cp -r /asset-input/* /asset-output/',
                  'cp -r node_modules /asset-output/'
                ].join(' && ')
              ],
              local: {
                tryBundle(outputDir: string) {
                  require('child_process').execSync(
                    `cd functions/${functionPath} && npm install && npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cloudfront @aws-sdk/client-s3 @aws-sdk/client-lambda @aws-sdk/client-sfn @aws-sdk/client-acm jszip uuid && mkdir -p ${outputDir} && cp -r * ${outputDir} && cp -r node_modules ${outputDir}`,
                    { stdio: 'inherit' }
                  );
                  return true;
                }
              }
            }
          }),
          environment,
          role: lambdaRole,
          timeout,
          memorySize,
          description: `${description} (Node.js)`,
        });
      }
    };

    // Define Step Function Lambda functions first
    const checkDeploymentStatus = createLambdaFunction(
      'CheckDeploymentStatusFunction',
      'common/checkDeploymentStatus',
      'Checks the deployment status of a CloudFront distribution'
    );

    const updateDistributionStatus = createLambdaFunction(
      'UpdateDistributionStatusFunction', 
      'common/updateDistributionStatus',
      'Updates the status of a CloudFront distribution in DynamoDB'
    );

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
    const listDistributionsFunction = createLambdaFunction(
      'ListDistributionsFunction',
      'distributions/list',
      'Lists CloudFront distributions'
    );

    const getDistributionFunction = createLambdaFunction(
      'GetDistributionFunction',
      'distributions/get', 
      'Gets a CloudFront distribution'
    );

    // Create the main distribution function with additional environment variables
    const createDistributionFunction = createLambdaFunction(
      'CreateDistributionFunction',
      'distributions/create',
      'Creates a CloudFront distribution',
      cdk.Duration.seconds(60), // Increased timeout for CloudFront operations
      512, // Increased memory for better performance
      {
        AWS_ACCOUNT_ID: this.account,
        DEPLOYMENT_STATE_MACHINE_ARN: deploymentStateMachine.stateMachineArn,
        LAMBDA_EDGE_EXECUTION_ROLE_ARN: lambdaRole.roleArn
      }
    );
    // Create proxy function for Node.js only (Python doesn't need proxy pattern)
    let createDistributionProxyFunction: lambda.Function;
    if (props.runtime === 'nodejs') {
      createDistributionProxyFunction = new lambda.Function(this, 'CreateDistributionProxyFunction', {
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
    } else {
      // For Python, use the main function directly (no proxy needed)
      createDistributionProxyFunction = createDistributionFunction;
    }

    const updateDistributionFunction = createLambdaFunction(
      'UpdateDistributionFunction',
      'distributions/update',
      'Updates a CloudFront distribution'
    );

    const deleteDistributionFunction = createLambdaFunction(
      'DeleteDistributionFunction',
      'distributions/delete',
      'Deletes a CloudFront distribution'
    );

    const getDistributionStatusFunction = createLambdaFunction(
      'GetDistributionStatusFunction',
      'distributions/getStatus',
      'Gets the status of a CloudFront distribution'
    );

    const invalidateDistributionFunction = createLambdaFunction(
      'InvalidateDistributionFunction',
      'distributions/invalidate',
      'Creates an invalidation for a CloudFront distribution'
    );

    // Create Lambda functions for origins
    const listOriginsFunction = createLambdaFunction(
      'ListOriginsFunction',
      'origins/list',
      'Lists S3 origins for CloudFront distributions'
    );

    const getOriginFunction = createLambdaFunction(
      'GetOriginFunction',
      'origins/get',
      'Gets an S3 origin for CloudFront distributions'
    );

    const createOriginFunction = createLambdaFunction(
      'CreateOriginFunction',
      'origins/create',
      'Creates an S3 origin for CloudFront distributions',
      cdk.Duration.seconds(60), // Increased timeout for S3 operations
      512 // Increased memory for better performance
    );

    const updateOriginFunction = createLambdaFunction(
      'UpdateOriginFunction',
      'origins/update',
      'Updates an S3 origin for CloudFront distributions',
      cdk.Duration.seconds(60), // Increased timeout for S3 operations
      512 // Increased memory for better performance
    );

    const deleteOriginFunction = createLambdaFunction(
      'DeleteOriginFunction',
      'origins/delete',
      'Deletes an S3 origin for CloudFront distributions',
      cdk.Duration.seconds(60), // Increased timeout for S3 operations
      512 // Increased memory for better performance
    );

    // Lambda@Edge Functions
    const createLambdaEdgeFunctionFunction = createLambdaFunction(
      'CreateLambdaEdgeFunctionFunction',
      'lambda-edge/create',
      'Creates a Lambda@Edge function for multi-origin routing',
      cdk.Duration.seconds(60), // Increased timeout for Lambda@Edge operations
      512, // Increased memory for better performance
      {
        LAMBDA_EDGE_EXECUTION_ROLE_ARN: lambdaRole.roleArn
      }
    );

    const listLambdaEdgeFunctionsFunction = createLambdaFunction(
      'ListLambdaEdgeFunctionsFunction',
      'lambda-edge/list',
      'Lists Lambda@Edge functions'
    );

    const getLambdaEdgeFunctionFunction = createLambdaFunction(
      'GetLambdaEdgeFunctionFunction',
      'lambda-edge/get',
      'Gets a Lambda@Edge function'
    );

    const previewLambdaEdgeFunctionFunction = createLambdaFunction(
      'PreviewLambdaEdgeFunctionFunction',
      'lambda-edge/preview',
      'Previews Lambda@Edge function code'
    );

    // Create Lambda functions for templates
    const listTemplatesFunction = createLambdaFunction(
      'ListTemplatesFunction',
      'templates/list',
      'Lists CloudFront distribution templates'
    );

    const getTemplateFunction = createLambdaFunction(
      'GetTemplateFunction',
      'templates/get',
      'Gets a CloudFront distribution template'
    );

    const createTemplateFunction = createLambdaFunction(
      'CreateTemplateFunction',
      'templates/create',
      'Creates a CloudFront distribution template'
    );
    
    // Create proxy function for handling CORS and invoking the main function
    // Create proxy function for Node.js only (Python doesn't need proxy pattern)
    let createTemplateProxyFunction: lambda.Function;
    if (props.runtime === 'nodejs') {
      createTemplateProxyFunction = new lambda.Function(this, 'CreateTemplateProxyFunction', {
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
    } else {
      // For Python, use the main function directly (no proxy needed)
      createTemplateProxyFunction = createTemplateFunction;
    }

    const updateTemplateFunction = createLambdaFunction(
      'UpdateTemplateFunction',
      'templates/update',
      'Updates a CloudFront distribution template'
    );

    const deleteTemplateFunction = createLambdaFunction(
      'DeleteTemplateFunction',
      'templates/delete',
      'Deletes a CloudFront distribution template'
    );

    const applyTemplateFunction = createLambdaFunction(
      'ApplyTemplateFunction',
      'templates/apply',
      'Applies a CloudFront distribution template',
      cdk.Duration.seconds(60), // Increased timeout for template application
      512, // Increased memory for better performance
      {
        CREATE_DISTRIBUTION_FUNCTION: createDistributionFunction.functionName
      }
    );

    // Create API resources and methods
    const distributionsResource = this.api.root.addResource('distributions');
    const distributionResource = distributionsResource.addResource('{id}');
    const distributionStatusResource = distributionResource.addResource('status');
    const distributionInvalidateResource = distributionResource.addResource('invalidate');

    const templatesResource = this.api.root.addResource('templates');
    const templateResource = templatesResource.addResource('{id}');
    const templateApplyResource = templateResource.addResource('apply');

    // Lambda@Edge API resources
    const lambdaEdgeResource = this.api.root.addResource('lambda-edge');
    const lambdaEdgeFunctionsResource = lambdaEdgeResource.addResource('functions');
    const lambdaEdgeFunctionResource = lambdaEdgeFunctionsResource.addResource('{id}');
    const lambdaEdgePreviewResource = lambdaEdgeResource.addResource('preview');

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
    const listCertificatesFunction = createLambdaFunction(
      'ListCertificatesFunction',
      'certificates/list',
      'Lists SSL certificates from ACM'
    );

    const getCertificateFunction = createLambdaFunction(
      'GetCertificateFunction',
      'certificates/get',
      'Gets SSL certificate details from ACM'
    );

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

    // Configure API methods for Lambda@Edge functions
    lambdaEdgeFunctionsResource.addMethod('GET', new apigateway.LambdaIntegration(listLambdaEdgeFunctionsFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    lambdaEdgeFunctionsResource.addMethod('POST', new apigateway.LambdaIntegration(createLambdaEdgeFunctionFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    lambdaEdgeFunctionResource.addMethod('GET', new apigateway.LambdaIntegration(getLambdaEdgeFunctionFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    lambdaEdgePreviewResource.addMethod('POST', new apigateway.LambdaIntegration(previewLambdaEdgeFunctionFunction), {
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
