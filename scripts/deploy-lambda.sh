#!/bin/bash
# Script to deploy a Lambda function with its dependencies

# Usage: ./deploy-lambda.sh <function-directory> <function-name>
# Example: ./deploy-lambda.sh functions/distributions/create CfManagerBackendStack-CreateDistributionFunction5F-8dVytjuIERtv

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <function-directory> <function-name>"
    exit 1
fi

FUNCTION_DIR=$1
FUNCTION_NAME=$2

echo "Deploying $FUNCTION_NAME from $FUNCTION_DIR"

# Create a temporary directory for the deployment package
TEMP_DIR=$(mktemp -d)
echo "Created temporary directory: $TEMP_DIR"

# Copy function code to the temporary directory
cp -r $FUNCTION_DIR/* $TEMP_DIR/
cd $TEMP_DIR

# Install dependencies
echo "Installing dependencies..."
npm install

# Create the deployment package
echo "Creating deployment package..."
zip -r function.zip .

# Update the Lambda function
echo "Updating Lambda function..."
aws lambda update-function-code --function-name $FUNCTION_NAME --zip-file fileb://function.zip

# Clean up
cd -
rm -rf $TEMP_DIR
echo "Deployment complete!"
