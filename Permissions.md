# 🔐 CloudFront Manager - IAM Permissions Guide

This document provides the **minimal IAM permissions** required to deploy the CloudFront Manager CDK project following the **principle of least privilege**.

## 📋 **Overview**

The CloudFront Manager requires permissions across multiple AWS services to deploy its serverless architecture. This guide provides the exact permissions needed for deployment **without the CI/CD pipeline stack**.

### **Deployment Scope**
- ✅ **Core Infrastructure** (CfManagerStack)
- ✅ **Backend Services** (CfManagerBackendStack) 
- ✅ **Frontend Hosting** (CfManagerFrontendStack)
- ✅ **Status Monitoring** (CfManagerStatusMonitorStack)
- ❌ **CI/CD Pipeline** (CfManagerPipelineStack) - **Not included**

## 🎯 **Complete Minimal IAM Policy**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CDKCorePermissions",
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudFormationPermissions",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet"
      ],
      "Resource": [
        "arn:aws:cloudformation:*:*:stack/CfManager*/*",
        "arn:aws:cloudformation:*:*:stack/CDKToolkit/*"
      ]
    },
    {
      "Sid": "S3Permissions",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketWebsite",
        "s3:PutBucketWebsite",
        "s3:DeleteBucketWebsite",
        "s3:GetBucketCORS",
        "s3:PutBucketCORS",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cdk-*",
        "arn:aws:s3:::cdk-*/*",
        "arn:aws:s3:::cfmanager-frontend-*",
        "arn:aws:s3:::cfmanager-frontend-*/*"
      ]
    },
    {
      "Sid": "LambdaPermissions",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:PublishVersion",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:TagResource",
        "lambda:UntagResource"
      ],
      "Resource": [
        "arn:aws:lambda:*:*:function:CfManager*",
        "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*"
      ]
    },
    {
      "Sid": "APIGatewayPermissions",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PUT",
        "apigateway:DELETE",
        "apigateway:PATCH",
        "apigateway:UpdateRestApiPolicy",
        "apigateway:CreateDeployment",
        "apigateway:CreateStage",
        "apigateway:UpdateStage",
        "apigateway:DeleteStage",
        "apigateway:CreateAuthorizer",
        "apigateway:UpdateAuthorizer",
        "apigateway:DeleteAuthorizer",
        "apigateway:CreateRequestValidator"
      ],
      "Resource": [
        "arn:aws:apigateway:*::/restapis",
        "arn:aws:apigateway:*::/restapis/*"
      ]
    },
    {
      "Sid": "CloudFrontPermissions",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution",
        "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution",
        "cloudfront:DeleteDistribution",
        "cloudfront:CreateOriginAccessControl",
        "cloudfront:GetOriginAccessControl",
        "cloudfront:DeleteOriginAccessControl",
        "cloudfront:CreateCachePolicy",
        "cloudfront:GetCachePolicy",
        "cloudfront:TagResource",
        "cloudfront:UntagResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBPermissions",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:UpdateTable",
        "dynamodb:TagResource",
        "dynamodb:UntagResource"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/CfManager-*"
      ]
    },
    {
      "Sid": "CognitoPermissions",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool",
        "cognito-idp:DeleteUserPool",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:CreateUserPoolClient",
        "cognito-idp:DeleteUserPoolClient",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:TagResource",
        "cognito-idp:UntagResource"
      ],
      "Resource": [
        "arn:aws:cognito-idp:*:*:userpool/*"
      ]
    },
    {
      "Sid": "StepFunctionsPermissions",
      "Effect": "Allow",
      "Action": [
        "states:CreateStateMachine",
        "states:DeleteStateMachine",
        "states:DescribeStateMachine",
        "states:UpdateStateMachine",
        "states:TagResource",
        "states:UntagResource"
      ],
      "Resource": [
        "arn:aws:states:*:*:stateMachine:CfManager*"
      ]
    },
    {
      "Sid": "CloudWatchPermissions",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "logs:TagLogGroup",
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/lambda/CfManager*",
        "arn:aws:events:*:*:rule/CfManager*"
      ]
    },
    {
      "Sid": "IAMPermissions",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::*:role/CfManager*",
        "arn:aws:iam::*:role/cdk-*"
      ]
    }
  ]
}
```

## 📊 **Permissions Breakdown by Service**

### **1. AWS CDK & CloudFormation**
**Purpose**: Core CDK deployment and stack management
```json
{
  "Services": ["sts", "cloudformation"],
  "Resources": ["CfManager* stacks", "CDKToolkit stack"],
  "Operations": ["Stack lifecycle", "Change sets", "Role assumption"]
}
```

### **2. Amazon S3**
**Purpose**: CDK assets storage and frontend hosting
```json
{
  "Resources": [
    "cdk-* buckets (CDK assets)",
    "cfmanager-frontend-* buckets (Static website hosting)"
  ],
  "Operations": ["Bucket management", "Object operations", "Website configuration"]
}
```

### **3. AWS Lambda**
**Purpose**: 25 Lambda functions including Lambda@Edge
```json
{
  "Resources": [
    "CfManager* functions (Backend APIs)",
    "*-multi-origin-func-* functions (Lambda@Edge in us-east-1)"
  ],
  "Operations": ["Function lifecycle", "Versioning", "Permissions"]
}
```

### **4. Amazon API Gateway**
**Purpose**: REST API for frontend-backend communication
```json
{
  "Resources": ["All REST APIs"],
  "Operations": ["API lifecycle", "Deployments", "Authorizers", "Stages"]
}
```

### **5. Amazon CloudFront**
**Purpose**: CDN distributions and cache policies
```json
{
  "Resources": ["All CloudFront resources"],
  "Operations": ["Distributions", "Origin Access Control", "Cache policies"]
}
```

### **6. Amazon DynamoDB**
**Purpose**: 4 database tables for application data
```json
{
  "Resources": ["CfManager-* tables"],
  "Tables": ["distributions", "templates", "origins", "lambda-edge-functions"],
  "Operations": ["Table management", "Tagging"]
}
```

### **7. Amazon Cognito**
**Purpose**: User authentication and authorization
```json
{
  "Resources": ["User pools and clients"],
  "Operations": ["User pool management", "Client configuration"]
}
```

### **8. AWS Step Functions**
**Purpose**: Status monitoring workflows
```json
{
  "Resources": ["CfManager* state machines"],
  "Operations": ["State machine lifecycle", "Tagging"]
}
```

### **9. Amazon CloudWatch**
**Purpose**: Logging and event scheduling
```json
{
  "Resources": ["CfManager* log groups and rules"],
  "Operations": ["Log group management", "Event rules", "Targets"]
}
```

### **10. AWS IAM**
**Purpose**: Service roles for Lambda functions and other services
```json
{
  "Resources": ["CfManager* roles", "cdk-* roles"],
  "Operations": ["Role lifecycle", "Policy management", "Role assumption"]
}
```

## 🔒 **Security Best Practices**

### **Principle of Least Privilege**
- ✅ **Resource-specific ARNs** instead of wildcards where possible
- ✅ **Minimal action sets** for each service
- ✅ **Scoped to CloudFront Manager resources** using naming patterns
- ✅ **No runtime permissions** (only deployment permissions)

### **Resource Restrictions**
```json
{
  "CloudFormation": "arn:aws:cloudformation:*:*:stack/CfManager*/*",
  "S3": "arn:aws:s3:::cfmanager-frontend-*",
  "Lambda": "arn:aws:lambda:*:*:function:CfManager*",
  "DynamoDB": "arn:aws:dynamodb:*:*:table/CfManager-*",
  "IAM": "arn:aws:iam::*:role/CfManager*"
}
```

### **Regional Considerations**
- **Primary Region**: `ap-northeast-1` (most resources)
- **Lambda@Edge**: `us-east-1` (required for CloudFront)
- **CloudFront**: Global service (accessed via us-east-1)

## 🚀 **Deployment Instructions**

### **1. Create IAM Policy**
```bash
# Create IAM policy from the JSON above
aws iam create-policy \
  --policy-name CloudFrontManagerDeploymentPolicy \
  --policy-document file://permissions-policy.json
```

### **2. Attach to User/Role**
```bash
# Attach to IAM user
aws iam attach-user-policy \
  --user-name your-deployment-user \
  --policy-arn arn:aws:iam::ACCOUNT:policy/CloudFrontManagerDeploymentPolicy

# Or attach to IAM role
aws iam attach-role-policy \
  --role-name your-deployment-role \
  --policy-arn arn:aws:iam::ACCOUNT:policy/CloudFrontManagerDeploymentPolicy
```

### **3. Bootstrap CDK**
```bash
# One-time CDK bootstrap (if not already done)
cdk bootstrap
```

### **4. Deploy Stacks**
```bash
# Deploy all stacks except pipeline
cdk deploy CfManagerStack CfManagerBackendStack CfManagerFrontendStack CfManagerStatusMonitorStack

# Or deploy all at once
cdk deploy --all --exclude CfManagerPipelineStack
```

## ⚠️ **Important Notes**

### **Excluded Permissions**
The following permissions are **NOT included** as they're not needed without the CI/CD pipeline:
- ❌ **CodePipeline** permissions
- ❌ **CodeBuild** permissions
- ❌ **CodeCommit** permissions

### **Runtime vs Deployment Permissions**
This policy provides **deployment permissions only**. The deployed Lambda functions will have their own execution roles with runtime permissions for:
- DynamoDB data operations (GetItem, PutItem, UpdateItem, DeleteItem, Scan)
- CloudFront API calls (CreateDistribution, GetDistribution, etc.)
- S3 operations (CreateBucket, PutBucketPolicy, etc.)
- Lambda@Edge function management

### **Regional Requirements**
- **Lambda@Edge functions** must be created in `us-east-1`
- **ACM certificates** for CloudFront must be in `us-east-1`
- **Primary application** resources are in `ap-northeast-1`

## 🔍 **Troubleshooting**

### **Common Permission Errors**

#### **CloudFormation Access Denied**
```
Error: User is not authorized to perform: cloudformation:CreateStack
Solution: Ensure CloudFormation permissions are correctly configured
```

#### **Lambda@Edge Creation Failed**
```
Error: User is not authorized to perform: lambda:CreateFunction on resource: arn:aws:lambda:us-east-1:*
Solution: Verify Lambda permissions include us-east-1 region for Lambda@Edge
```

#### **S3 Bucket Creation Failed**
```
Error: Access Denied when creating S3 bucket
Solution: Check S3 permissions and bucket naming patterns
```

### **Verification Commands**
```bash
# Test CloudFormation permissions
aws cloudformation describe-stacks --region ap-northeast-1

# Test Lambda permissions
aws lambda list-functions --region ap-northeast-1
aws lambda list-functions --region us-east-1

# Test S3 permissions
aws s3 ls

# Test API Gateway permissions
aws apigateway get-rest-apis --region ap-northeast-1
```

## 📚 **Additional Resources**

- [AWS CDK Permissions Guide](https://docs.aws.amazon.com/cdk/v2/guide/permissions.html)
- [CloudFormation IAM Permissions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-template.html)
- [Lambda@Edge IAM Roles](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-permissions.html)
- [API Gateway IAM Permissions](https://docs.aws.amazon.com/apigateway/latest/developerguide/permissions.html)

---

**Last Updated**: 2025-07-10  
**CDK Version**: v2.x  
**Minimum Required Permissions**: ✅ Verified  
**Security Review**: ✅ Principle of Least Privilege Applied
