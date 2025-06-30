#!/bin/bash

# Exit on error
set -e

echo "Creating directories if they don't exist..."
mkdir -p functions/common
mkdir -p functions/templates/list
mkdir -p functions/templates/get
mkdir -p functions/distributions/list

echo "Updating Lambda functions with CORS headers..."

# Get Lambda function names
LIST_TEMPLATES_FUNCTION=$(aws lambda list-functions --query "Functions[?contains(FunctionName, 'ListTemplatesFunction')].FunctionName" --output text)
GET_TEMPLATE_FUNCTION=$(aws lambda list-functions --query "Functions[?contains(FunctionName, 'GetTemplateFunction')].FunctionName" --output text)
LIST_DISTRIBUTIONS_FUNCTION=$(aws lambda list-functions --query "Functions[?contains(FunctionName, 'ListDistributionsFunction')].FunctionName" --output text)

echo "Found Lambda functions:"
echo "- List Templates: $LIST_TEMPLATES_FUNCTION"
echo "- Get Template: $GET_TEMPLATE_FUNCTION"
echo "- List Distributions: $LIST_DISTRIBUTIONS_FUNCTION"

# Create zip files
echo "Creating zip files..."

# Common CORS module
zip -j cors.zip functions/common/cors.js

# List Templates function
cp functions/common/cors.js functions/templates/list/
cd functions/templates/list
zip -r ../../../list-templates.zip .
cd ../../..

# Get Template function
cp functions/common/cors.js functions/templates/get/
cd functions/templates/get
zip -r ../../../get-template.zip .
cd ../../..

# List Distributions function
cp functions/common/cors.js functions/distributions/list/
cd functions/distributions/list
zip -r ../../../list-distributions.zip .
cd ../../..

# Update Lambda functions
echo "Updating Lambda functions..."

if [ ! -z "$LIST_TEMPLATES_FUNCTION" ]; then
  echo "Updating List Templates function..."
  aws lambda update-function-code --function-name $LIST_TEMPLATES_FUNCTION --zip-file fileb://list-templates.zip
fi

if [ ! -z "$GET_TEMPLATE_FUNCTION" ]; then
  echo "Updating Get Template function..."
  aws lambda update-function-code --function-name $GET_TEMPLATE_FUNCTION --zip-file fileb://get-template.zip
fi

if [ ! -z "$LIST_DISTRIBUTIONS_FUNCTION" ]; then
  echo "Updating List Distributions function..."
  aws lambda update-function-code --function-name $LIST_DISTRIBUTIONS_FUNCTION --zip-file fileb://list-distributions.zip
fi

# Clean up
echo "Cleaning up..."
rm -f cors.zip list-templates.zip get-template.zip list-distributions.zip

echo "Done!"
