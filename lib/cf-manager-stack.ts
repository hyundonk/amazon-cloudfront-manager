import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

export class CfManagerStack extends cdk.Stack {
  // Expose resources to be used by other stacks
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly distributionsTable: dynamodb.Table;
  public readonly templatesTable: dynamodb.Table;
  public readonly historyTable: dynamodb.Table;
  public readonly originsTable: dynamodb.Table;
  public readonly lambdaExecutionRole: iam.Role;
  public readonly customCachePolicy: cloudfront.CachePolicy;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB tables
    this.distributionsTable = new dynamodb.Table(this, 'DistributionsTable', {
      partitionKey: { name: 'distributionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for querying by name
    this.distributionsTable.addGlobalSecondaryIndex({
      indexName: 'NameIndex',
      partitionKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.templatesTable = new dynamodb.Table(this, 'TemplatesTable', {
      partitionKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for querying by category
    this.templatesTable.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.historyTable = new dynamodb.Table(this, 'HistoryTable', {
      partitionKey: { name: 'distributionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expiresAt'
    });

    // S3 Origins table
    this.originsTable = new dynamodb.Table(this, 'OriginsTable', {
      partitionKey: { name: 'originId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Add GSI for querying by bucket name
    this.originsTable.addGlobalSecondaryIndex({
      indexName: 'BucketNameIndex',
      partitionKey: { name: 'bucketName', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Cognito user pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add admin group
    const adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'Administrators',
      description: 'Administrators with full access to CloudFront Manager',
    });

    // Add read-only group
    const readOnlyGroup = new cognito.CfnUserPoolGroup(this, 'ReadOnlyGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'ReadOnly',
      description: 'Users with read-only access to CloudFront Manager',
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO
      ],
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
    });

    // Lambda execution role with CloudFront permissions
    this.lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
    });

    // Add CloudFront permissions
    this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
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

    // Add S3 permissions
    this.lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
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
        's3:GetBucketWebsite',
        's3:DeleteBucketWebsite',
        's3:PutBucketCors',
        's3:GetBucketCors',
        's3:PutBucketPublicAccessBlock',
        's3:GetBucketPublicAccessBlock'
      ],
      resources: ['*']
    }));

    // Grant DynamoDB permissions
    this.distributionsTable.grantReadWriteData(this.lambdaExecutionRole);
    this.templatesTable.grantReadWriteData(this.lambdaExecutionRole);
    this.historyTable.grantReadWriteData(this.lambdaExecutionRole);
    this.originsTable.grantReadWriteData(this.lambdaExecutionRole);

    // Create custom cache policy for distributions
    this.customCachePolicy = new cloudfront.CachePolicy(this, 'CachingOptimizedCompressionDisabled', {
      cachePolicyName: 'CachingOptimized_CompressionDisabled',
      comment: 'Policy with caching enabled. Does not support Gzip and Brotli compression',
      defaultTtl: cdk.Duration.days(1),
      maxTtl: cdk.Duration.days(365),
      minTtl: cdk.Duration.seconds(0),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none()
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { 
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID'
    });
    
    new cdk.CfnOutput(this, 'UserPoolClientId', { 
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID'
    });
    
    new cdk.CfnOutput(this, 'DistributionsTableName', { 
      value: this.distributionsTable.tableName,
      description: 'DynamoDB Distributions Table Name'
    });
    
    new cdk.CfnOutput(this, 'TemplatesTableName', { 
      value: this.templatesTable.tableName,
      description: 'DynamoDB Templates Table Name'
    });
    
    new cdk.CfnOutput(this, 'HistoryTableName', { 
      value: this.historyTable.tableName,
      description: 'DynamoDB History Table Name'
    });
    
    new cdk.CfnOutput(this, 'OriginsTableName', { 
      value: this.originsTable.tableName,
      description: 'DynamoDB Origins Table Name'
    });
    
    new cdk.CfnOutput(this, 'CustomCachePolicyId', { 
      value: this.customCachePolicy.cachePolicyId,
      description: 'Custom Cache Policy ID for CachingOptimized_CompressionDisabled'
    });
  }
}
