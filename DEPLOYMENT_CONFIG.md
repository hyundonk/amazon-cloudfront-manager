# Deployment Configuration Guide

This guide explains how to configure the CloudFront Manager for deployment in your AWS environment.

## Required Configuration Files

Before deploying, you need to create the following configuration files from their templates:

### 1. Lambda Invoke Policy

```bash
cp lambda-invoke-policy.example.json lambda-invoke-policy.json
```

Edit `lambda-invoke-policy.json` and replace:
- `${AWS_REGION}` - Your AWS region (e.g., `us-east-1`)
- `${AWS_ACCOUNT_ID}` - Your AWS account ID
- `${LAMBDA_FUNCTION_NAME}` - Your Lambda function name

### 2. DynamoDB Policy

```bash
cp dynamodb-policy.example.json dynamodb-policy.json
```

Edit `dynamodb-policy.json` and replace:
- `${AWS_REGION}` - Your AWS region
- `${AWS_ACCOUNT_ID}` - Your AWS account ID
- `${DISTRIBUTIONS_TABLE_NAME}` - Your distributions table name
- `${HISTORY_TABLE_NAME}` - Your history table name
- `${TEMPLATES_TABLE_NAME}` - Your templates table name

### 3. Frontend Environment Configuration

```bash
cp frontend-simple/js/env.example.js frontend-simple/js/env.js
```

Edit `frontend-simple/js/env.js` and replace:
- `${AWS_REGION}` - Your AWS region
- `${USER_POOL_ID}` - Your Cognito User Pool ID
- `${USER_POOL_CLIENT_ID}` - Your Cognito User Pool Client ID
- `${API_GATEWAY_URL}` - Your API Gateway URL

## Getting Configuration Values

After deploying the CDK stacks, you can get the required values from:

1. **CDK Outputs**: Check the output of `cdk deploy --all`
2. **AWS Console**: 
   - DynamoDB table names from DynamoDB console
   - Cognito pool IDs from Cognito console
   - API Gateway URL from API Gateway console
3. **AWS CLI**:
   ```bash
   # Get stack outputs
   aws cloudformation describe-stacks --stack-name CfManagerStack
   aws cloudformation describe-stacks --stack-name CfManagerBackendStack
   ```

## Security Notes

- **Never commit** the actual configuration files (`*.json`, `env.js`) to version control
- **Always use** the template files (`.example.*`) in version control
- **Use environment variables** or AWS Parameter Store for production deployments
- **Rotate credentials** regularly and update configuration files accordingly

## Automated Configuration

For automated deployments, consider using:
- AWS Parameter Store to store configuration values
- Environment variables in CI/CD pipelines
- CDK context values for stack-specific configuration
- AWS Secrets Manager for sensitive configuration data
