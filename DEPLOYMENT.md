# Deployment Instructions

This document provides instructions for deploying the CloudFront Manager application with the updated code.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18.x or later
- AWS CDK v2 installed globally (`npm install -g aws-cdk`)

## Deployment Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the CDK Project

```bash
npm run build
```

### 3. Deploy the CDK Stacks

```bash
cdk deploy --all
```

Or deploy individual stacks:

```bash
cdk deploy CfManagerStack
cdk deploy CfManagerBackendStack
cdk deploy CfManagerFrontendStack
```

### 4. Manual Deployment of Lambda Functions

If you need to update the Lambda functions without redeploying the entire stack, you can use the provided deployment script:

```bash
# Deploy the create distribution function
./scripts/deploy-lambda.sh functions/distributions/create CfManagerBackendStack-CreateDistributionFunction5F-8dVytjuIERtv

# Deploy the create distribution proxy function
./scripts/deploy-lambda.sh functions/distributions/create-proxy CfManagerCreateDistributionProxy
```

## Key Changes

1. **AWS SDK v3 Migration**: Updated Lambda functions to use AWS SDK v3 instead of v2, which is not included by default in Node.js 18.x runtime.

2. **CORS Configuration**: Updated CORS headers to allow requests from any origin.

3. **Proxy Pattern**: Implemented a proxy pattern for the create distribution function to handle CORS properly.

4. **IAM Permissions**: Added necessary IAM permissions to allow Lambda functions to invoke other Lambda functions.

5. **Deployment Packaging**: Added proper bundling configuration to include dependencies in the Lambda deployment packages.

## Troubleshooting

If you encounter any issues with the deployment, check the following:

1. **Lambda Function Logs**: Check CloudWatch Logs for the Lambda functions to see any errors.

2. **API Gateway Logs**: Check CloudWatch Logs for the API Gateway to see any issues with the API requests.

3. **CORS Issues**: If you're seeing CORS errors in the browser, make sure the CORS headers are properly configured in both the Lambda functions and the API Gateway.

4. **IAM Permissions**: Make sure the Lambda execution role has the necessary permissions to access DynamoDB, CloudFront, and other AWS services.

5. **Deployment Packaging**: Make sure the Lambda functions are properly packaged with all required dependencies.
