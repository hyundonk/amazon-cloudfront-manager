import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export interface CfManagerStatusMonitorStackProps extends cdk.StackProps {
  distributionsTableName: string;
  historyTableName: string;
  runtime: 'python' | 'nodejs';
}

export class CfManagerStatusMonitorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CfManagerStatusMonitorStackProps) {
    super(scope, id, props);

    // Create separate IAM roles for each function
    const updateStatusRole = new iam.Role(this, 'UpdateStatusLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    const findPendingRole = new iam.Role(this, 'FindPendingLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add CloudFront permissions to update status role
    updateStatusRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudfront:GetDistribution',
        'cloudfront:UpdateDistribution',
        'cloudfront:ListDistributions',
      ],
      resources: ['*'],
    }));

    // Add Lambda permissions for managing Lambda@Edge function permissions
    updateStatusRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:GetPolicy',
      ],
      resources: [
        `arn:aws:lambda:us-east-1:${this.account}:function:*-multi-origin-func-*`,
      ],
    }));

    // Add DynamoDB permissions to both roles
    const dynamoDbResources = [
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.distributionsTableName}`,
      `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.historyTableName}`,
    ];

    updateStatusRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:Query',
      ],
      resources: dynamoDbResources,
    }));

    findPendingRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:Scan',
      ],
      resources: [dynamoDbResources[0]],  // Only need scan on distributions table
    }));

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
      role: iam.Role,
      environment: { [key: string]: string },
      timeout: cdk.Duration = cdk.Duration.seconds(30),
      memorySize: number = 256
    ): lambda.Function => {
      if (props.runtime === 'python') {
        return new lambda.Function(this, id, {
          runtime: lambda.Runtime.PYTHON_3_9,
          handler: 'lambda_function.lambda_handler',
          code: lambda.Code.fromAsset(`functions-python/${functionPath}`),
          environment,
          role,
          timeout,
          memorySize,
          description: `${description} (Python)`,
          layers: commonUtilsLayer ? [commonUtilsLayer] : undefined,
        });
      } else {
        // Node.js runtime
        return new lambda.Function(this, id, {
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: 'index.handler',
          code: lambda.Code.fromAsset(`functions/${functionPath}`),
          environment,
          role,
          timeout,
          memorySize,
          description: `${description} (Node.js)`,
        });
      }
    };

    // Create Lambda function to check and update distribution statuses
    const updateStatusFunction = createLambdaFunction(
      'UpdateDistributionStatusFunction',
      'distributions/check-status',
      'Checks and updates CloudFront distribution status',
      updateStatusRole,
      {
        DISTRIBUTIONS_TABLE: props.distributionsTableName,
        HISTORY_TABLE: props.historyTableName,
      },
      cdk.Duration.seconds(60),
      256
    );

    // Create Lambda function to find pending distributions
    const findPendingFunction = createLambdaFunction(
      'FindPendingDistributionsFunction',
      'distributions/find-pending',
      'Finds pending CloudFront distributions for status updates',
      findPendingRole,
      {
        DISTRIBUTIONS_TABLE: props.distributionsTableName,
        UPDATE_STATUS_FUNCTION_NAME: updateStatusFunction.functionName,
      },
      cdk.Duration.seconds(30),
      256
    );

    // Grant permission for find pending function to invoke update status function
    updateStatusFunction.grantInvoke(findPendingFunction);

    // Create CloudWatch Event Rule
    const rule = new events.Rule(this, 'ScheduledStatusCheck', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Periodically check CloudFront distribution status',
      targets: [new targets.LambdaFunction(findPendingFunction)],
    });

    // Output the ARNs of the Lambda functions
    new cdk.CfnOutput(this, 'UpdateStatusFunctionArn', {
      value: updateStatusFunction.functionArn,
      description: 'ARN of the Update Distribution Status Function',
    });

    new cdk.CfnOutput(this, 'FindPendingFunctionArn', {
      value: findPendingFunction.functionArn,
      description: 'ARN of the Find Pending Distributions Function',
    });
  }
}
