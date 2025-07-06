#!/bin/bash

# Exit on error
set -e

# Check if CfManagerFrontendStack exists
if ! aws cloudformation describe-stacks --stack-name CfManagerFrontendStack &> /dev/null; then
    echo "CfManagerFrontendStack does not exist. Deploying it now..."
    cd ..
    npm run build
    cdk deploy CfManagerFrontendStack
    cd frontend-simple
fi

# Check if CfManagerStack exists
if ! aws cloudformation describe-stacks --stack-name CfManagerStack &> /dev/null; then
    echo "CfManagerStack does not exist. You need to deploy it for authentication to work."
    echo "Run: cdk deploy CfManagerStack"
    exit 1
fi

# Check if CfManagerBackendStack exists
if ! aws cloudformation describe-stacks --stack-name CfManagerBackendStack &> /dev/null; then
    echo "CfManagerBackendStack does not exist. You need to deploy it for API functionality."
    echo "Run: cdk deploy CfManagerBackendStack"
    exit 1
fi

# Get AWS region
REGION=$(aws configure get region)

# Get CloudFormation outputs
echo "Getting CloudFormation outputs..."
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
CUSTOM_CACHE_POLICY_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='CustomCachePolicyId'].OutputValue" --output text)
API_URL=$(aws cloudformation describe-stacks --stack-name CfManagerBackendStack --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)
UI_BUCKET=$(aws cloudformation describe-stacks --stack-name CfManagerFrontendStack --query "Stacks[0].Outputs[?OutputKey=='UIBucketName'].OutputValue" --output text)
DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name CfManagerFrontendStack --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text)

# Update environment configuration
echo "Updating environment configuration..."
cp js/env.template.js js/env.js
sed -i.bak "s|{{REGION}}|$REGION|g" js/env.js
sed -i.bak "s|{{USER_POOL_ID}}|$USER_POOL_ID|g" js/env.js
sed -i.bak "s|{{USER_POOL_CLIENT_ID}}|$USER_POOL_CLIENT_ID|g" js/env.js
sed -i.bak "s|{{API_URL}}|$API_URL|g" js/env.js
sed -i.bak "s|{{CUSTOM_CACHE_POLICY_ID}}|$CUSTOM_CACHE_POLICY_ID|g" js/env.js
rm js/env.js.bak

# Deploy to S3
echo "Deploying to S3 bucket: $UI_BUCKET"
aws s3 sync ./ s3://$UI_BUCKET --delete --exclude "*.sh" --exclude "*.bak" --exclude ".DS_Store"

# Create CloudFront invalidation
echo "Creating CloudFront invalidation for distribution: $DISTRIBUTION_ID"
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"

# Get CloudFront domain name
CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks --stack-name CfManagerFrontendStack --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" --output text)

echo ""
echo "Deployment complete!"
echo "Your CloudFront Manager is available at: https://$CLOUDFRONT_DOMAIN"
echo ""
echo "Authentication Configuration:"
echo "  Region: $REGION"
echo "  User Pool ID: $USER_POOL_ID"
echo "  User Pool Client ID: $USER_POOL_CLIENT_ID"
echo ""
echo "API URL: $API_URL"
echo ""
