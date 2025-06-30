#!/bin/bash

# S3 Bucket Creation Script with Best Practices
# This script creates an S3 bucket with encryption, versioning, and lifecycle policies

# Exit on error
set -e

# Default configuration
BUCKET_NAME=""
REGION="us-east-1"
NONCURRENT_VERSION_EXPIRATION_DAYS=90

# Function to display usage information
usage() {
  echo "Usage: $0 --name BUCKET_NAME [--region REGION]"
  echo ""
  echo "Options:"
  echo "  --name BUCKET_NAME    Name of the S3 bucket to create (required)"
  echo "  --region REGION       AWS region to create the bucket in (default: us-east-1)"
  echo "  --help                Display this help message"
  echo ""
  echo "Example:"
  echo "  $0 --name my-unique-bucket --region eu-west-1"
  exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --name)
      BUCKET_NAME="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Check if bucket name is provided
if [ -z "$BUCKET_NAME" ]; then
  echo "Error: Bucket name is required"
  usage
fi

# Validate bucket name
if [[ ! $BUCKET_NAME =~ ^[a-z0-9][a-z0-9\.-]{1,61}[a-z0-9]$ ]]; then
  echo "Error: Invalid bucket name format. Bucket names must:"
  echo "- Contain only lowercase letters, numbers, dots, and hyphens"
  echo "- Begin and end with a letter or number"
  echo "- Be between 3 and 63 characters long"
  exit 1
fi

echo "Creating S3 bucket with recommended security configurations..."
echo "Bucket name: $BUCKET_NAME"
echo "Region: $REGION"

# Step 1: Create the bucket
echo "Step 1: Creating bucket..."
if [ "$REGION" = "us-east-1" ]; then
  # us-east-1 requires special handling (no LocationConstraint)
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION"
else
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

# Step 2: Enable default encryption
echo "Step 2: Enabling default encryption..."
aws s3api put-bucket-encryption \
  --bucket "$BUCKET_NAME" \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        },
        "BucketKeyEnabled": true
      }
    ]
  }'

# Step 3: Block all public access
echo "Step 3: Blocking public access..."
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Step 4: Enable versioning
echo "Step 4: Enabling versioning..."
aws s3api put-bucket-versioning \
  --bucket "$BUCKET_NAME" \
  --versioning-configuration Status=Enabled

# Step 5: Add lifecycle policy
echo "Step 5: Adding lifecycle policy..."
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_NAME" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "ExpireOldVersions",
        "Status": "Enabled",
        "NoncurrentVersionExpiration": {
          "NoncurrentDays": '"$NONCURRENT_VERSION_EXPIRATION_DAYS"'
        },
        "Filter": {
          "Prefix": ""
        }
      }
    ]
  }'

echo "✅ S3 bucket '$BUCKET_NAME' created successfully with recommended configurations!"
echo ""
echo "Next steps:"
echo "1. Upload content to your bucket:"
echo "   aws s3 cp your-file.html s3://$BUCKET_NAME/"
echo "2. If using with CloudFront, add a bucket policy to allow CloudFront access"
echo "   (You'll need your CloudFront distribution ID first)"
