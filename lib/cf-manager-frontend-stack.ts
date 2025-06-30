import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class CfManagerFrontendStack extends cdk.Stack {
  // Expose resources to be used by other stacks
  public readonly uiBucket: s3.Bucket;
  public readonly uiDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for UI
    this.uiBucket = new s3.Bucket(this, 'UIBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000
        }
      ]
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: 'Access to the CloudFront Manager UI bucket'
    });

    // Grant read permissions to CloudFront
    this.uiBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [this.uiBucket.arnForObjects('*')],
      principals: [new iam.CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
    }));

    // Create a log bucket with ACLs enabled for CloudFront logging
    const logBucket = new s3.Bucket(this, 'LogBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        }
      ],
      // Enable ACLs for CloudFront logging
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED
    });

    // CloudFront distribution for UI
    this.uiDistribution = new cloudfront.Distribution(this, 'UIDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(this.uiBucket, {
          originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        }
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enableLogging: true,
      logBucket: logBucket,
      logFilePrefix: 'cloudfront-logs/',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Deploy a placeholder index.html
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.data('index.html', '<html><body><h1>CloudFront Manager</h1><p>Placeholder page. Replace with your React build.</p></body></html>')],
      destinationBucket: this.uiBucket,
      distribution: this.uiDistribution,
      distributionPaths: ['/*']
    });

    // Outputs
    new cdk.CfnOutput(this, 'UIBucketName', { 
      value: this.uiBucket.bucketName,
      description: 'S3 Bucket for UI assets'
    });
    
    new cdk.CfnOutput(this, 'CloudFrontDomainName', { 
      value: this.uiDistribution.distributionDomainName,
      description: 'CloudFront Domain Name'
    });
    
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', { 
      value: this.uiDistribution.distributionId,
      description: 'CloudFront Distribution ID'
    });
    
    new cdk.CfnOutput(this, 'LogBucketName', { 
      value: logBucket.bucketName,
      description: 'S3 Bucket for CloudFront logs'
    });
  }
}
