# CloudFront Manager CDK Project

This project contains the AWS CDK infrastructure code for deploying the CloudFront Manager application, which allows developers to create, modify, and manage CloudFront distributions through a user-friendly interface.

## Architecture

The CloudFront Manager application consists of the following components:

1. **Frontend**:
   - Static UI hosted on Amazon S3
   - CloudFront distribution for content delivery
   - React-based single-page application

2. **Backend**:
   - API Gateway for RESTful API endpoints
   - Lambda functions for CloudFront management operations
   - DynamoDB tables for storing distribution configurations and templates
   - Step Functions for handling long-running operations
   - Cognito User Pool for authentication and authorization

3. **Status Monitoring System**:
   - Automated CloudFront distribution status tracking
   - Periodic status checks and database updates
   - CloudWatch Events for scheduling
   - Lambda functions for status processing

4. **SSL Certificate Management**:
   - Integration with AWS Certificate Manager (ACM)
   - Support for custom SSL certificates in CloudFront distributions
   - Automated certificate validation and management
   - Certificate expiration monitoring

5. **Origin Access Control (OAC) Management**:
   - Automated OAC creation for each S3 origin
   - Secure access control between CloudFront and S3 buckets
   - Automatic policy management and distribution tracking
   - One-OAC-per-origin architecture for granular security

6. **CI/CD Pipeline**:
   - CodePipeline for continuous integration and deployment
   - CodeBuild for building and testing the application
   - S3 for artifact storage

## Project Structure

```
cf-manager-cdk/
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definitions
│   ├── cf-manager-stack.ts             # Core infrastructure stack
│   ├── cf-manager-frontend-stack.ts    # Frontend stack
│   ├── cf-manager-backend-stack.ts     # Backend stack
│   ├── cf-manager-status-monitor-stack.ts # Status monitoring stack
│   └── cf-manager-pipeline-stack.ts    # CI/CD pipeline stack
├── functions/              # Lambda function code
│   ├── distributions/      # Distribution management functions
│   ├── templates/          # Template management functions
│   ├── origins/            # S3 origins management functions (with OAC)
│   ├── certificates/       # SSL certificate management functions
│   └── common/             # Shared utility functions
├── frontend-simple/        # Frontend application
│   ├── index.html          # Main HTML file
│   ├── js/                 # JavaScript files
│   ├── css/                # Stylesheets
│   └── deploy.sh           # Frontend deployment script
├── test/                   # Tests for the CDK stacks
└── cdk.json                # CDK configuration
```

## SSL Certificate Management with AWS Certificate Manager

The CloudFront Manager now includes comprehensive SSL certificate management using AWS Certificate Manager (ACM). This feature allows you to create secure HTTPS distributions with custom domain names.

### Overview

AWS Certificate Manager provides free SSL/TLS certificates for use with AWS services like CloudFront. The key requirement is that certificates for CloudFront **must be created in the US East (N. Virginia) region** regardless of where your other resources are located.

### Features Implemented

1. **Certificate API Integration**:
   - List available SSL certificates from ACM
   - Get detailed certificate information
   - Certificate expiration monitoring

2. **Template SSL Support**:
   - SSL certificate configuration in distribution templates
   - Custom domain name support
   - HTTPS policy configuration (redirect, enforce, allow)
   - TLS version selection

3. **Frontend Integration**:
   - Certificate dropdown in template creation
   - SSL configuration forms
   - Certificate status display

### API Endpoints

#### Certificates
- `GET /certificates` - List all available SSL certificates
- `GET /certificates/{arn}` - Get detailed certificate information

### Template SSL Configuration

Templates now support SSL certificate configuration with the following fields:

```javascript
{
  "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/...",
  "customDomains": "example.com, www.example.com",
  "viewerProtocol": "redirect-to-https",
  "minTlsVersion": "TLSv1.2_2021",
  "sslConfig": {
    "certificateArn": "...",
    "customDomains": "...",
    "viewerProtocol": "redirect-to-https",
    "minTlsVersion": "TLSv1.2_2021"
  }
}
```

### Implementation Status

✅ **Completed (Steps 3-5)**:
- Backend certificate API endpoints
- Template SSL configuration processing
- Frontend SSL forms and certificate dropdown
- Certificate listing and selection

🔄 **To Be Implemented (Steps 6-8)**:
- DNS configuration guidance
- Certificate validation and testing
- Monitoring and best practices

## Complete SSL Certificate Setup Guide

### Step 1: Create Certificate in AWS Certificate Manager

#### Using AWS Console:

1. **Navigate to Certificate Manager**:
   - Go to AWS Console → Certificate Manager
   - **Critical**: Switch to **US East (N. Virginia)** region
   - Click "Request a certificate"

2. **Request Public Certificate**:
   - Select "Request a public certificate"
   - Click "Next"

3. **Add Domain Names**:
   ```
   Primary domain: example.com
   Additional names: www.example.com
   Wildcard option: *.example.com
   ```

4. **Choose Validation Method**:
   - **DNS validation** (recommended for automation)
   - **Email validation** (requires email access)

5. **Add Tags**:
   ```
   Key: Project, Value: CloudFront-Manager
   Key: Environment, Value: Production
   ```

#### Using AWS CLI:

```bash
# Request certificate (must be in us-east-1)
aws acm request-certificate \
    --domain-name example.com \
    --subject-alternative-names www.example.com *.example.com \
    --validation-method DNS \
    --region us-east-1 \
    --tags Key=Project,Value=CloudFront-Manager
```

### Step 2: Complete DNS Validation

#### Get Validation Records:

```bash
# Get certificate validation details
aws acm describe-certificate \
    --certificate-arn arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID \
    --region us-east-1
```

#### Add DNS Records:

The response will include CNAME records like:
```
Name: _abc123def456.example.com
Value: _xyz789abc123.acm-validations.aws.
```

Add these to your DNS provider:
- **Route 53**: Can be automated
- **Other providers**: Manual addition required

### Step 3: Configure Templates with SSL

Use the CloudFront Manager interface to create templates with SSL certificates:

1. **Open Template Creation Modal**
2. **Select SSL Certificate** from the dropdown
3. **Enter Custom Domains** covered by the certificate
4. **Choose HTTPS Policy**:
   - Allow HTTP and HTTPS
   - Redirect HTTP to HTTPS (recommended)
   - HTTPS Only
5. **Select Minimum TLS Version** (TLS 1.2 recommended)

### Step 4: DNS Configuration for Custom Domains

After creating a distribution with custom certificate:

1. **Get CloudFront Domain Name**:
   ```
   Example: d1234567890123.cloudfront.net
   ```

2. **Update DNS Records**:
   ```bash
   # For root domain (use ALIAS if supported)
   Type: A (Alias)
   Name: example.com
   Value: d1234567890123.cloudfront.net

   # For subdomains
   Type: CNAME
   Name: www
   Value: d1234567890123.cloudfront.net
   ```

### Step 5: Validation and Testing

#### Test SSL Configuration:

```bash
# Test HTTPS connection
curl -I https://example.com

# Check certificate details
openssl s_client -connect example.com:443 -servername example.com

# Test SSL Labs rating
# Visit: https://www.ssllabs.com/ssltest/analyze.html?d=example.com
```

#### Verify Certificate Installation:

1. **Browser Test**: Visit your custom domain
2. **Certificate Details**: Check certificate in browser
3. **SSL Labs Test**: Run comprehensive SSL test

### Step 6: Best Practices and Security

#### Security Recommendations:

1. **Always use HTTPS**: Set `ViewerProtocolPolicy` to `redirect-to-https` or `https-only`
2. **Modern TLS**: Use `TLSv1.2_2021` or newer
3. **SNI-only**: Use `sni-only` for cost efficiency
4. **HSTS Headers**: Configure security headers in your origin

#### Cost Optimization:

- **ACM certificates**: Free for AWS services
- **SNI SSL**: No additional cost
- **Dedicated IP SSL**: $600/month per distribution (avoid unless necessary)

#### Monitoring:

1. **Certificate Expiration**: ACM auto-renews certificates in use
2. **CloudWatch Metrics**: Monitor SSL/TLS handshake errors
3. **Certificate Status**: Check certificate status in ACM console

### Step 7: Troubleshooting

#### Common Issues:

1. **Certificate Not Available in CloudFront**:
   - Ensure certificate is in **us-east-1** region
   - Verify certificate status is **ISSUED**
   - Check domain names match exactly

2. **DNS Validation Stuck**:
   ```bash
   # Check DNS propagation
   dig _validation-record.example.com CNAME
   
   # Verify DNS record is correct
   nslookup -type=CNAME _validation-record.example.com
   ```

3. **Custom Domain Not Working**:
   - Verify DNS points to CloudFront domain
   - Check certificate covers the domain
   - Ensure distribution is deployed

#### Certificate Management Commands:

```bash
# List certificates
aws acm list-certificates --region us-east-1

# Get certificate details
aws acm describe-certificate \
    --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/CERT-ID \
    --region us-east-1

# Check certificate status
aws acm describe-certificate \
    --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/CERT-ID \
    --region us-east-1 \
    --query 'Certificate.Status'
```

### Step 8: Advanced Configuration

#### Multiple Domain Certificates:

```bash
# Request certificate for multiple domains
aws acm request-certificate \
    --domain-name example.com \
    --subject-alternative-names www.example.com api.example.com blog.example.com \
    --validation-method DNS \
    --region us-east-1
```

#### Wildcard Certificates:

```bash
# Request wildcard certificate
aws acm request-certificate \
    --domain-name "*.example.com" \
    --subject-alternative-names example.com \
    --validation-method DNS \
    --region us-east-1
```

#### Certificate Renewal:

ACM automatically renews certificates that are:
- In use by AWS services (CloudFront, ALB, etc.)
- Validated via DNS validation
- Not expired

```bash
# Check renewal eligibility
aws acm describe-certificate \
    --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/CERT-ID \
    --region us-east-1 \
    --query 'Certificate.RenewalEligibility'
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18.x or later
- AWS CDK v2 installed globally (`npm install -g aws-cdk`)
- API Gateway CloudWatch Logs role configured (see setup instructions below)

### API Gateway CloudWatch Logs Role Setup

API Gateway requires a CloudWatch Logs role to be configured at the account level before it can enable logging. This is a one-time setup per AWS account.

**Step 1: Create the IAM role for API Gateway**

```bash
# Create the role with trust policy for API Gateway
aws iam create-role \
    --role-name APIGatewayCloudWatchLogsRole \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "apigateway.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }'
```

**Step 2: Attach the CloudWatch Logs policy**

```bash
# Attach the AWS managed policy for CloudWatch Logs
aws iam attach-role-policy \
    --role-name APIGatewayCloudWatchLogsRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs
```

**Step 3: Configure API Gateway account settings**

```bash
# Get your AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Set the CloudWatch Logs role ARN in API Gateway account settings
aws apigateway update-account \
    --patch-operations op=replace,path=/cloudwatchRoleArn,value=arn:aws:iam::${ACCOUNT_ID}:role/APIGatewayCloudWatchLogsRole
```

**Verification:**

```bash
# Verify the role is set correctly
aws apigateway get-account
```

You should see output similar to:
```json
{
    "cloudwatchRoleArn": "arn:aws:iam::123456789012:role/APIGatewayCloudWatchLogsRole",
    "throttleSettings": {
        "burstLimit": 5000,
        "rateLimit": 10000.0
    }
}
```

**Note**: This setup is required only once per AWS account. If you encounter the error "CloudWatch Logs role ARN must be set in account settings to enable logging" during deployment, it means this prerequisite step was not completed.

## Deployment

1. Install dependencies:

```bash
npm install
```

2. Bootstrap the CDK environment (if not already done):

```bash
cdk bootstrap
```

3. Deploy the stacks:

```bash
cdk deploy --all
```

Or deploy individual stacks:

```bash
cdk deploy CfManagerStack
cdk deploy CfManagerFrontendStack
cdk deploy CfManagerBackendStack
cdk deploy CfManagerPipelineStack
cdk deploy CfManagerStatusMonitorStack
```

## Frontend Development

The frontend code should be developed in a separate repository. After building the frontend, the assets can be deployed to the S3 bucket created by the `CfManagerFrontendStack`.

```bash
# Example deployment of frontend assets
aws s3 sync ./frontend/build/ s3://BUCKET_NAME --delete
aws cloudfront create-invalidation --distribution-id DISTRIBUTION_ID --paths "/*"
```

## API Architecture and Communication

The CloudFront Manager uses a multi-layered API architecture with two main communication patterns:

### 1. Frontend Application ↔ API Gateway Communication

#### **HTTP REST APIs via HTTPS**

The frontend JavaScript application communicates with AWS API Gateway using standard HTTP REST APIs with JWT authentication:

```javascript
// Base API URL from environment configuration
const API_BASE_URL = 'https://20dnuxjzrd.execute-api.ap-northeast-1.amazonaws.com/api/'

// Generic API call function with Cognito JWT authentication
async function apiCall(endpoint, method = 'GET', data = null) {
    const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint.slice(1) : endpoint}`;
    
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}` // Cognito JWT token
        }
    };
    
    if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    return await response.json();
}
```

#### **Authentication & Authorization**
- **Cognito JWT tokens** included in all API requests
- **API Gateway Cognito Authorizer** validates tokens before routing to Lambda functions
- **CORS headers** included in all responses for cross-origin browser requests

#### **CORS Configuration**
```javascript
// All API responses include standardized CORS headers
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
};
```

### 2. Lambda Functions ↔ AWS Control Plane APIs

#### **AWS SDK v3 Integration**

Lambda functions use AWS SDK v3 to interact with various AWS services for infrastructure management:

#### **CloudFront Service APIs**
```javascript
const { CloudFrontClient, CreateDistributionCommand, GetDistributionCommand } = require('@aws-sdk/client-cloudfront');

const cloudfront = new CloudFrontClient({ region: 'us-east-1' }); // CloudFront is global but uses us-east-1

// Create CloudFront Distribution
const createParams = {
    DistributionConfig: {
        CallerReference: `${name}-${Date.now()}`,
        Comment: `${name} - CloudFront Distribution`,
        Enabled: true,
        Origins: { /* S3 origin configuration */ },
        DefaultCacheBehavior: { 
            CachePolicyId: process.env.CUSTOM_CACHE_POLICY_ID,
            ViewerProtocolPolicy: 'redirect-to-https'
        }
    }
};

const result = await cloudfront.send(new CreateDistributionCommand(createParams));
```

#### **DynamoDB APIs for State Management**
```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamodb = new DynamoDBDocumentClient(DynamoDBClient.from(new DynamoDBClient()));

// Store distribution record with metadata
await dynamodb.send(new PutCommand({
    TableName: process.env.DISTRIBUTIONS_TABLE,
    Item: {
        distributionId: distributionId,
        name: name,
        cloudfrontId: cfResult.Distribution.Id,
        status: cfResult.Distribution.Status,
        isMultiOrigin: false,
        createdAt: new Date().toISOString(),
        config: distributionConfig
    }
}));
```

#### **S3 APIs for Origin Management**
```javascript
const { S3Client, CreateBucketCommand, PutBucketPolicyCommand, PutBucketWebsiteCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({ region: originRegion });

// Create S3 bucket for CloudFront origin
await s3.send(new CreateBucketCommand({
    Bucket: bucketName,
    CreateBucketConfiguration: {
        LocationConstraint: region !== 'us-east-1' ? region : undefined
    }
}));

// Configure bucket policy for Origin Access Control (OAC)
await s3.send(new PutBucketPolicyCommand({
    Bucket: bucketName,
    Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: `arn:aws:s3:::${bucketName}/*`,
            Condition: {
                StringEquals: {
                    "AWS:SourceArn": distributionArn
                }
            }
        }]
    })
}));
```

#### **AWS Certificate Manager (ACM) APIs**
```javascript
const { ACMClient, ListCertificatesCommand, DescribeCertificateCommand } = require('@aws-sdk/client-acm');

const acm = new ACMClient({ region: 'us-east-1' }); // ACM for CloudFront must be in us-east-1

// List available SSL certificates for CloudFront
const certificates = await acm.send(new ListCertificatesCommand({
    CertificateStatuses: ['ISSUED'],
    Includes: {
        keyTypes: ['RSA-2048', 'EC-256']
    }
}));
```

#### **Lambda APIs for Lambda@Edge Functions**
```javascript
const { LambdaClient, CreateFunctionCommand, PublishVersionCommand } = require('@aws-sdk/client-lambda');

const lambda = new LambdaClient({ region: 'us-east-1' }); // Lambda@Edge must be in us-east-1

// Create Lambda@Edge function for multi-origin routing
await lambda.send(new CreateFunctionCommand({
    FunctionName: functionName,
    Runtime: 'nodejs18.x',
    Role: process.env.LAMBDA_EDGE_EXECUTION_ROLE_ARN,
    Handler: 'index.handler',
    Code: { ZipFile: Buffer.from(generatedFunctionCode) },
    Description: 'Lambda@Edge function for multi-origin routing',
    Timeout: 5,
    MemorySize: 128,
    Publish: true // Required for Lambda@Edge association
}));
```

#### **Step Functions APIs for Workflow Orchestration**
```javascript
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const stepfunctions = new SFNClient({ region: process.env.AWS_REGION });

// Start distribution status monitoring workflow
await stepfunctions.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATUS_MONITOR_STATE_MACHINE_ARN,
    input: JSON.stringify({
        distributionId: distributionId,
        cloudfrontId: cfResult.Distribution.Id,
        action: 'monitor_deployment'
    })
}));
```

### **IAM Permissions & Service Integration**

#### **Lambda Execution Role Permissions**
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateDistribution",
                "cloudfront:GetDistribution",
                "cloudfront:UpdateDistribution",
                "cloudfront:DeleteDistribution",
                "cloudfront:CreateInvalidation",
                "cloudfront:CreateOriginAccessControl",
                "cloudfront:DeleteOriginAccessControl"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:CreateBucket",
                "s3:DeleteBucket",
                "s3:PutBucketPolicy",
                "s3:PutBucketWebsite",
                "s3:PutBucketCors",
                "s3:ListBucket"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem",
                "dynamodb:Scan",
                "dynamodb:Query"
            ],
            "Resource": [
                "arn:aws:dynamodb:*:*:table/distributions",
                "arn:aws:dynamodb:*:*:table/templates",
                "arn:aws:dynamodb:*:*:table/origins",
                "arn:aws:dynamodb:*:*:table/lambda-edge-functions"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "lambda:CreateFunction",
                "lambda:PublishVersion",
                "lambda:GetFunction",
                "lambda:DeleteFunction"
            ],
            "Resource": "arn:aws:lambda:us-east-1:*:function:*"
        }
    ]
}
```

### **Error Handling & Resilience Patterns**

#### **AWS SDK Error Handling**
```javascript
try {
    const result = await cloudfront.send(new CreateDistributionCommand(params));
    return { success: true, data: result };
} catch (error) {
    console.error('CloudFront API Error:', error);
    
    // Handle specific AWS service errors
    if (error.name === 'InvalidArgument') {
        return { success: false, error: 'Invalid distribution configuration', details: error.message };
    } else if (error.name === 'TooManyDistributions') {
        return { success: false, error: 'Distribution limit exceeded' };
    } else if (error.name === 'DistributionAlreadyExists') {
        return { success: false, error: 'Distribution with this configuration already exists' };
    } else {
        return { success: false, error: 'Failed to create distribution', details: error.message };
    }
}
```

### **Regional Architecture Considerations**

#### **Service Regional Requirements**
- **API Gateway**: Deployed in `ap-northeast-1` (primary region)
- **CloudFront APIs**: Global service, accessed via `us-east-1` endpoint
- **Lambda@Edge Functions**: Must be created in `us-east-1` region
- **ACM Certificates**: Must be in `us-east-1` for CloudFront usage
- **DynamoDB Tables**: Deployed in `ap-northeast-1` (primary region)
- **S3 Origins**: Can be in any region based on user selection
- **Step Functions**: Deployed in `ap-northeast-1` (primary region)

#### **Cross-Region API Calls**
```javascript
// Different AWS service clients for different regions
const cloudfrontClient = new CloudFrontClient({ region: 'us-east-1' });    // Global service
const acmClient = new ACMClient({ region: 'us-east-1' });                  // For CloudFront certs
const lambdaEdgeClient = new LambdaClient({ region: 'us-east-1' });        // Lambda@Edge
const dynamodbClient = new DynamoDBClient({ region: 'ap-northeast-1' });   // Primary region
const s3Client = new S3Client({ region: originRegion });                   // Origin-specific region
```

### **Asynchronous Operation Patterns**

#### **Long-Running Operations**
- **Distribution Creation**: Immediate API response, status monitoring via Step Functions
- **Status Updates**: CloudWatch Events trigger periodic status checks
- **Cache Invalidations**: Asynchronous CloudFront operations with status polling

#### **Event-Driven Architecture**
```javascript
// CloudWatch Events rule for status monitoring
const statusMonitorRule = new events.Rule(this, 'StatusMonitorRule', {
    schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    description: 'Triggers distribution status monitoring every 5 minutes'
});

statusMonitorRule.addTarget(new targets.LambdaFunction(findPendingDistributionsFunction));
```

This comprehensive API architecture ensures reliable communication between the frontend interface and AWS infrastructure services, with proper error handling, authentication, and regional considerations for optimal performance and security.

## Multi-Origin Lambda@Edge Implementation: Tips and Lessons Learned

This section documents the key insights, challenges, and solutions encountered during the implementation of the multi-origin Lambda@Edge functionality in the CloudFront Manager. These lessons learned will help future developers avoid common pitfalls and implement similar features more efficiently.

### **Overview of Multi-Origin Lambda@Edge System**

The multi-origin Lambda@Edge feature enables CloudFront distributions to route requests to different S3 origins based on the viewer's geographic location. This provides optimal performance by serving content from the closest regional origin.

**Key Components:**
- **Frontend Interface**: Multi-origin configuration UI with region mapping and preview
- **Backend API**: Lambda functions for creating and managing Lambda@Edge functions
- **Lambda@Edge Functions**: Dynamically generated routing logic deployed to CloudFront edge locations
- **DynamoDB Storage**: Persistent storage for Lambda@Edge function metadata and configurations

### **Critical Implementation Lessons**

#### **1. Environment Variable Management in Browser vs. Node.js**

**Problem**: Frontend JavaScript tried to access `process.env.CUSTOM_CACHE_POLICY_ID`, causing `ReferenceError: process is not defined`.

**Root Cause**: `process.env` is a Node.js environment variable that doesn't exist in browser JavaScript environments.

**Solution**: Implement proper environment configuration pattern:
```javascript
// ❌ Wrong - Browser doesn't have process.env
CachePolicyId: process.env.CUSTOM_CACHE_POLICY_ID

// ✅ Correct - Use window.ENV for browser
CachePolicyId: window.ENV.CUSTOM_CACHE_POLICY_ID
```

**Implementation Pattern:**
1. Create `env.template.js` with placeholders: `{{CUSTOM_CACHE_POLICY_ID}}`
2. Update `deploy.sh` to replace placeholders with CloudFormation outputs
3. Use `window.ENV` object in frontend JavaScript

**Key Takeaway**: Always distinguish between server-side (Node.js) and client-side (browser) environment variable access patterns.

#### **2. AWS SDK Version Compatibility**

**Problem**: Lambda@Edge generator used AWS SDK v2 (`aws-sdk`) while the main function used AWS SDK v3 (`@aws-sdk/*`), causing import errors.

**Root Cause**: Mixing different versions of AWS SDK in the same Lambda function package.

**Solution**: Standardize on AWS SDK v3 throughout the application:
```javascript
// ❌ Wrong - AWS SDK v2
const AWS = require('aws-sdk');
const lambda = new AWS.Lambda({ region: 'us-east-1' });
await lambda.createFunction(params).promise();

// ✅ Correct - AWS SDK v3
const { LambdaClient, CreateFunctionCommand } = require('@aws-sdk/client-lambda');
const lambda = new LambdaClient({ region: 'us-east-1' });
await lambda.send(new CreateFunctionCommand(params));
```

**Key Takeaway**: Maintain consistency in AWS SDK versions across all Lambda functions and shared modules.

#### **3. Lambda Function Packaging and ZIP File Creation**

**Problem**: `InvalidParameterValueException: Could not unzip uploaded file` when creating Lambda@Edge functions.

**Root Cause**: Attempting to create Lambda functions with raw JavaScript strings instead of proper ZIP files.

**Solution**: Use JSZip library to create proper ZIP packages:
```javascript
// ❌ Wrong - Raw string buffer
Code: {
    ZipFile: Buffer.from(code)
}

// ✅ Correct - Proper ZIP file
const JSZip = require('jszip');
const zip = new JSZip();
zip.file('index.js', code);
const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

Code: {
    ZipFile: zipBuffer
}
```

**CDK Bundling Update**: Include JSZip in Lambda function dependencies:
```typescript
'npm install @aws-sdk/client-lambda jszip'
```

**Key Takeaway**: Lambda functions require properly formatted ZIP files, not raw code strings.

#### **4. IAM Permissions for Cross-Service Operations**

**Problem**: `AccessDeniedException` when Lambda functions tried to create other Lambda functions.

**Root Cause**: Lambda execution role lacked permissions to create Lambda@Edge functions in us-east-1 region.

**Solution**: Add comprehensive IAM permissions:
```json
{
    "Effect": "Allow",
    "Action": [
        "lambda:CreateFunction",
        "lambda:PublishVersion",
        "lambda:GetFunction",
        "lambda:DeleteFunction",
        "iam:PassRole"
    ],
    "Resource": [
        "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*",
        "arn:aws:iam::*:role/LambdaExecutionRole"
    ]
}
```

**Key Takeaway**: Lambda functions creating other AWS resources need explicit IAM permissions for those operations.

#### **5. Lambda@Edge Versioned ARN Requirement**

**Problem**: `InvalidLambdaFunctionAssociation: The function ARN must reference a specific function version`.

**Root Cause**: CloudFront requires Lambda@Edge function ARNs to include version numbers (e.g., `:1`, `:2`).

**Solution**: Ensure versioned ARNs are used:
```javascript
// ❌ Wrong - Unversioned ARN
LambdaFunctionARN: "arn:aws:lambda:us-east-1:123456789012:function:my-function"

// ✅ Correct - Versioned ARN
LambdaFunctionARN: "arn:aws:lambda:us-east-1:123456789012:function:my-function:1"

// Implementation
if (!functionData.versionArn.match(/:\d+$/)) {
    functionData.versionArn = `${lambdaResult.FunctionArn}:${lambdaResult.Version || '1'}`;
}
```

**Key Takeaway**: Always use versioned ARNs when associating Lambda@Edge functions with CloudFront distributions.

#### **6. Lambda Function Active State Wait Logic**

**Problem**: `InvalidLambdaFunctionAssociation: The function must be in an Active state. The current state for function ... is Pending`.

**Root Cause**: CloudFront requires Lambda@Edge functions to be in "Active" state before they can be associated with distributions. Newly created Lambda functions start in "Pending" state and take a few seconds to become "Active".

**Solution**: Implement a wait mechanism to ensure the Lambda function is active before proceeding:
```javascript
/**
 * Wait for Lambda function to become active
 */
const waitForFunctionActive = async (functionName, maxWaitTime = 60000) => {
    const startTime = Date.now();
    
    console.log(`Waiting for Lambda function ${functionName} to become active...`);
    
    while (Date.now() - startTime < maxWaitTime) {
        try {
            const result = await lambda.send(new GetFunctionCommand({
                FunctionName: functionName
            }));
            
            console.log(`Function state: ${result.Configuration.State}`);
            
            if (result.Configuration.State === 'Active') {
                console.log(`Lambda function ${functionName} is now active`);
                return true;
            }
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.error('Error checking function state:', error);
            throw error;
        }
    }
    
    throw new Error(`Lambda function ${functionName} did not become active within ${maxWaitTime}ms`);
};

// Usage in Lambda@Edge creation flow
await waitForFunctionActive(functionName);
```

**Implementation Details:**
- **Maximum wait time**: 60 seconds (typically functions become active within 5-10 seconds)
- **Check interval**: 2 seconds to balance responsiveness and API rate limits
- **Error handling**: Throws error if function doesn't become active within timeout
- **Logging**: Comprehensive logs for debugging and monitoring

**Key Takeaway**: Always wait for Lambda functions to reach "Active" state before associating them with CloudFront distributions.

#### **7. Lambda@Edge IAM Role Trust Policy Requirements**

**Problem**: `InvalidLambdaFunctionAssociation: The function execution role must be assumable with edgelambda.amazonaws.com as well as lambda.amazonaws.com principals`.

**Root Cause**: Lambda@Edge functions require a special IAM role trust policy that allows **both** `lambda.amazonaws.com` AND `edgelambda.amazonaws.com` service principals to assume the role. Regular Lambda functions only require `lambda.amazonaws.com`.

**Solution**: Update the IAM role trust policy to include both service principals:
```typescript
// ❌ Wrong - Only allows lambda.amazonaws.com
const lambdaRole = new iam.Role(this, 'LambdaRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
  ]
});

// ✅ Correct - Allows both lambda.amazonaws.com and edgelambda.amazonaws.com
const lambdaRole = new iam.Role(this, 'LambdaRole', {
  assumedBy: new iam.CompositePrincipal(
    new iam.ServicePrincipal('lambda.amazonaws.com'),
    new iam.ServicePrincipal('edgelambda.amazonaws.com')
  ),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
  ]
});
```

**Resulting Trust Policy JSON:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": [
          "lambda.amazonaws.com",
          "edgelambda.amazonaws.com"
        ]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Required IAM Permissions for Lambda@Edge Functions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

**Additional Permissions for Lambda@Edge Creation:**
The Lambda function that creates Lambda@Edge functions needs these permissions:
```json
{
  "Effect": "Allow",
  "Action": [
    "lambda:CreateFunction",
    "lambda:PublishVersion",
    "lambda:GetFunction",
    "lambda:DeleteFunction",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
    "lambda:TagResource",
    "lambda:UntagResource",
    "lambda:ListTags",
    "lambda:EnableReplication*",
    "iam:PassRole"
  ],
  "Resource": [
    "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*",
    "arn:aws:iam::*:role/LambdaExecutionRole"
  ]
}
```

**Key Requirements:**
- **Trust Policy**: Must include both `lambda.amazonaws.com` and `edgelambda.amazonaws.com`
- **Region**: Lambda@Edge functions must be created in `us-east-1` region
- **Permissions**: Standard Lambda execution permissions plus CloudWatch Logs
- **PassRole**: The creating function needs `iam:PassRole` permission for the Lambda@Edge execution role

**Verification Commands:**
```bash
# Check IAM role trust policy
aws iam get-role --role-name YOUR_ROLE_NAME --query 'Role.AssumeRolePolicyDocument'

# Verify Lambda@Edge function creation permissions
aws iam simulate-principal-policy \
  --policy-source-arn ROLE_ARN \
  --action-names lambda:CreateFunction \
  --resource-arns "arn:aws:lambda:us-east-1:*:function:*"
```

**Key Takeaway**: Lambda@Edge functions require dual service principal trust policies and must be created in us-east-1 region with proper IAM permissions.

#### **8. Variable Naming Consistency**

**Problem**: `ReferenceError: cloudfront is not defined` due to inconsistent variable naming.

**Root Cause**: Code referenced `cloudfront.send()` but the client was instantiated as `cloudfrontClient`.

**Solution**: Maintain consistent variable naming:
```javascript
// ✅ Consistent naming
const cloudfrontClient = new CloudFrontClient();
const result = await cloudfrontClient.send(new CreateDistributionCommand(params));
```

**Key Takeaway**: Use consistent and descriptive variable names throughout the codebase.

#### **9. Regional Architecture Considerations**

**Critical Regional Requirements:**
- **Lambda@Edge Functions**: Must be created in `us-east-1` region
- **ACM Certificates**: Must be in `us-east-1` for CloudFront usage
- **CloudFront APIs**: Global service, accessed via `us-east-1` endpoint
- **DynamoDB Tables**: Can be in primary region (`ap-northeast-1`)
- **S3 Origins**: Can be in any region based on user selection

**Implementation Pattern:**
```javascript
// Different clients for different regions
const lambdaEdgeClient = new LambdaClient({ region: 'us-east-1' });        // Lambda@Edge
const cloudfrontClient = new CloudFrontClient({ region: 'us-east-1' });    // CloudFront
const dynamodbClient = new DynamoDBClient({ region: 'ap-northeast-1' });   // Primary region
const s3Client = new S3Client({ region: originRegion });                   // Origin-specific
```

**Key Takeaway**: Understand and respect AWS service regional requirements, especially for CloudFront and Lambda@Edge.

### **Development Best Practices**

#### **1. Incremental Development and Testing**
- Implement and test each component individually
- Use comprehensive logging for debugging complex multi-service interactions
- Test error scenarios and edge cases thoroughly

#### **2. Error Handling Patterns**
```javascript
try {
    const result = await awsService.send(command);
    return { success: true, data: result };
} catch (error) {
    console.error('Service Error:', error);
    
    // Handle specific AWS service errors
    if (error.name === 'SpecificErrorType') {
        return { success: false, error: 'User-friendly message' };
    }
    
    return { success: false, error: 'Generic error message', details: error.message };
}
```

#### **3. Environment Configuration Management**
- Use template-based configuration for frontend applications
- Separate environment variables for different deployment stages
- Validate environment variables at application startup

#### **4. Dependency Management**
- Maintain consistent package versions across all Lambda functions
- Use CDK bundling to ensure all dependencies are included
- Document required packages in deployment scripts

### **Debugging Strategies**

#### **1. CloudWatch Logs Analysis**
- Use structured logging with consistent formats
- Include request IDs for tracing multi-step operations
- Log both successful operations and error conditions

#### **2. AWS CLI Verification**
```bash
# Verify Lambda@Edge functions
aws lambda list-functions --region us-east-1 --query 'Functions[?contains(FunctionName, `multi-origin`)].{Name:FunctionName,Runtime:Runtime}'

# Check CloudFront distributions
aws cloudfront list-distributions --query 'DistributionList.Items[*].{Id:Id,DomainName:DomainName,Status:Status}'

# Validate IAM permissions
aws iam simulate-principal-policy --policy-source-arn ROLE_ARN --action-names lambda:CreateFunction --resource-arns LAMBDA_ARN
```

#### **3. Frontend Debugging**
- Use browser developer tools to inspect API requests and responses
- Validate environment variable loading in browser console
- Test CORS configuration with different origins

### **Performance Considerations**

#### **1. Lambda Function Optimization**
- Use appropriate memory allocation for Lambda@Edge functions (128MB minimum)
- Minimize cold start times by keeping function code lightweight
- Cache frequently accessed data in function memory

#### **2. CloudFront Configuration**
- Use appropriate cache policies for different content types
- Configure proper TTL values for Lambda@Edge responses
- Monitor CloudFront metrics for performance optimization

### **Security Best Practices**

#### **1. IAM Principle of Least Privilege**
- Grant only necessary permissions for each Lambda function
- Use resource-specific ARNs instead of wildcards where possible
- Regularly audit and review IAM policies

#### **2. Lambda@Edge Security**
- Validate all input parameters in Lambda@Edge functions
- Use secure coding practices for origin selection logic
- Implement proper error handling to avoid information disclosure

### **Monitoring and Maintenance**

#### **1. CloudWatch Metrics**
- Monitor Lambda@Edge function execution metrics
- Set up alarms for error rates and execution duration
- Track CloudFront distribution performance metrics

#### **2. Automated Testing**
- Implement unit tests for Lambda@Edge routing logic
- Create integration tests for multi-origin functionality
- Use automated deployment pipelines with proper testing stages

### **Future Enhancements**

#### **1. Advanced Routing Logic**
- Implement A/B testing capabilities in Lambda@Edge functions
- Add support for custom routing rules based on request headers
- Integrate with AWS Global Accelerator for improved performance

#### **2. Management Interface Improvements**
- Add real-time monitoring dashboard for multi-origin distributions
- Implement bulk operations for managing multiple distributions
- Create templates for common multi-origin configurations

### **Conclusion**

The multi-origin Lambda@Edge implementation demonstrates the complexity of integrating multiple AWS services while maintaining proper error handling, security, and performance. The key to success is understanding the specific requirements and limitations of each service, implementing proper error handling, and following AWS best practices throughout the development process.

These lessons learned provide a foundation for future enhancements and similar implementations, helping developers avoid common pitfalls and build robust, scalable solutions.

## Lambda@Edge CloudFront Trigger Visibility

### **Critical Discovery: Console Navigation for Lambda@Edge Triggers**

**Important**: CloudFront triggers for Lambda@Edge functions appear on **versioned functions** (`:1`, `:2`, etc.), **NOT** on the `$LATEST` version in the AWS Lambda console.

#### **How to View CloudFront Triggers**

1. **Navigate to AWS Lambda Console** → us-east-1 region
2. **Find your Lambda@Edge function** (e.g., `demo49-multi-origin-func-2d0c6d6d`)
3. **Click the version dropdown** (defaults to `$LATEST`)
4. **Select the specific version** (`:1`, `:2`, etc.)
5. **Check Configuration → Triggers** on the versioned function

#### **Why This Happens**

- **CloudFront Requirement**: CloudFront only associates with versioned Lambda functions
- **Console Default**: AWS Lambda console defaults to showing `$LATEST` version
- **Trigger Location**: CloudFront triggers appear only on the specific version used by CloudFront

### **Required IAM Roles and Permissions**

#### **1. Lambda@Edge Execution Role (Minimum Required)**

**Trust Policy** - Must include BOTH service principals:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": [
          "lambda.amazonaws.com",
          "edgelambda.amazonaws.com"
        ]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Permissions Policy** - Minimum required permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

#### **2. Lambda Function Creation Role (For Creating Lambda@Edge Functions)**

**Required Actions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:PublishVersion",
        "lambda:GetFunction",
        "lambda:DeleteFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*",
        "arn:aws:iam::*:role/LambdaExecutionRole"
      ]
    }
  ]
}
```

#### **3. Status Monitor Role (For Managing Lambda@Edge Permissions)**

**Required Actions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution"
      ],
      "Resource": [
        "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*",
        "*"
      ]
    }
  ]
}
```

### **CloudFront Invoke Permission Requirements**

#### **Automatic Permission Addition**

The system automatically adds this permission to each Lambda@Edge function:

```json
{
  "Sid": "cloudfront-invoke-timestamp",
  "Effect": "Allow",
  "Principal": {
    "Service": "edgelambda.amazonaws.com"
  },
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:us-east-1:ACCOUNT:function:FUNCTION_NAME"
}
```

#### **Manual Permission Addition (If Needed)**

```bash
# Add CloudFront invoke permission to Lambda@Edge function
aws lambda add-permission \
  --function-name YOUR_LAMBDA_EDGE_FUNCTION \
  --statement-id cloudfront-invoke-manual \
  --action lambda:InvokeFunction \
  --principal edgelambda.amazonaws.com \
  --region us-east-1
```

### **Lambda@Edge Function Requirements**

#### **Critical Requirements**

1. **Region**: Must be created in `us-east-1` region
2. **Versioned ARN**: Must use versioned ARN (`:1`, `:2`) for CloudFront association
3. **Active State**: Function must be in "Active" state before CloudFront association
4. **Invoke Permission**: Must have `edgelambda.amazonaws.com` invoke permission
5. **Execution Role**: Must have dual service principal trust policy

#### **Function Creation Parameters**

```javascript
const lambdaParams = {
  FunctionName: functionName,
  Runtime: 'nodejs18.x',
  Role: 'arn:aws:iam::ACCOUNT:role/LambdaEdgeExecutionRole',
  Handler: 'index.handler',
  Code: { ZipFile: zipBuffer },
  Description: 'Lambda@Edge function for multi-origin routing',
  Timeout: 5,
  MemorySize: 128,
  Publish: true // REQUIRED: Creates versioned ARN for CloudFront
};
```

### **Troubleshooting CloudFront Triggers**

#### **Common Issues**

1. **Trigger not visible in console**:
   - ✅ Check versioned function (`:1`) instead of `$LATEST`
   - ✅ Verify CloudFront invoke permission exists
   - ✅ Confirm function is in "Active" state

2. **Permission errors**:
   - ✅ Verify execution role has dual service principals
   - ✅ Check `edgelambda.amazonaws.com` invoke permission
   - ✅ Ensure function creation role has `lambda:AddPermission`

3. **Association errors**:
   - ✅ Use versioned ARN (`:1`) not unversioned ARN
   - ✅ Wait for function to reach "Active" state
   - ✅ Verify function is in us-east-1 region

#### **Verification Commands**

```bash
# Check Lambda@Edge function permissions
aws lambda get-policy \
  --function-name YOUR_FUNCTION_NAME \
  --region us-east-1

# Verify function state
aws lambda get-function \
  --function-name YOUR_FUNCTION_NAME \
  --region us-east-1 \
  --query 'Configuration.State'

# Check CloudFront distribution associations
aws cloudfront get-distribution \
  --id YOUR_DISTRIBUTION_ID \
  --query 'Distribution.DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations'
```

### **Best Practices**

1. **Always check versioned functions** for CloudFront triggers
2. **Use dual service principal trust policies** for Lambda@Edge execution roles
3. **Wait for "Active" state** before associating with CloudFront
4. **Add invoke permissions** immediately after function creation
5. **Monitor CloudWatch Logs** in multiple regions for Lambda@Edge execution
6. **Use consistent naming** for Lambda@Edge functions to aid debugging


## API Endpoints

The CloudFront Manager API provides the following endpoints:

### Distributions

- `GET /distributions` - List all distributions
- `POST /distributions` - Create a new distribution
- `GET /distributions/{id}` - Get distribution details
- `PUT /distributions/{id}` - Update a distribution
- `DELETE /distributions/{id}` - Delete a distribution
- `GET /distributions/{id}/status` - Get deployment status
- `POST /distributions/{id}/invalidate` - Create an invalidation

### Templates

- `GET /templates` - List all templates
- `POST /templates` - Create a new template
- `GET /templates/{id}` - Get template details
- `PUT /templates/{id}` - Update a template
- `DELETE /templates/{id}` - Delete a template
- `POST /templates/{id}/apply` - Apply a template to create a distribution

### Origins

- `GET /origins` - List all S3 origins
- `POST /origins` - Create a new S3 origin (automatically creates OAC)
- `GET /origins/{id}` - Get origin details
- `PUT /origins/{id}` - Update an origin
- `DELETE /origins/{id}` - Delete an origin (automatically deletes OAC)

**Note**: Origin operations automatically manage Origin Access Control (OAC):
- **Creating an origin** automatically creates a dedicated OAC for the S3 bucket
- **Deleting an origin** automatically deletes the associated OAC (only if no distributions are using it)
- **Distribution creation** automatically associates with the origin's OAC
- **Distribution deletion** automatically removes association from the origin's OAC

## Security

The application implements the following security measures:

1. **Authentication**: Cognito User Pool for user authentication
2. **Authorization**: API Gateway authorizers to validate JWT tokens
3. **Least Privilege**: IAM roles with minimal permissions
4. **Encryption**: S3 bucket encryption and HTTPS for all communications
5. **Logging**: CloudWatch Logs for all Lambda functions and API Gateway

## Monitoring

- CloudWatch Logs for Lambda functions and API Gateway
- CloudWatch Metrics for API Gateway and Lambda
- CloudWatch Alarms for error rates and latency

## Status Monitoring System

The CloudFront Manager includes an automated status monitoring system that ensures CloudFront distribution statuses are kept up-to-date in the application database.

### Overview

The status monitoring system periodically checks and updates the status of CloudFront distributions in your DynamoDB table. This solves the problem where distributions remain in "InProgress" state in your frontend even after they're actually deployed.

### Components

1. **Check Status Function**:
   - Takes a distribution ID and CloudFront ID as input
   - Checks the current status of the CloudFront distribution
   - Updates the DynamoDB record if the status has changed
   - Records the status change in the history table

2. **Find Pending Function**:
   - Scans the DynamoDB table for distributions with "Creating" or "InProgress" status
   - For each pending distribution, invokes the Check Status function
   - Runs on a schedule to continuously monitor pending distributions

3. **CloudWatch Events Rule**:
   - Triggers the Find Pending function every 5 minutes
   - Ensures regular status updates without manual intervention

### How the Status Monitoring System Works

1. **Automated Status Checking**: 
   - The system includes a CloudWatch Events rule that triggers every 5 minutes
   - This rule invokes the FindPendingDistributionsFunction Lambda function

2. **Finding Distributions That Need Updates**:
   - The FindPendingDistributionsFunction scans the DynamoDB table for distributions with "Creating" or "InProgress" status
   - It identifies distributions that might need status updates

3. **Checking Current Status**:
   - For each pending distribution, it invokes the UpdateDistributionStatusFunction
   - This function calls the CloudFront API to get the current, real status of the distribution

4. **Updating the Database**:
   - If the status has changed (e.g., from "InProgress" to "Deployed"), it updates the record in DynamoDB
   - It also adds an entry to the history table to track the status change

5. **Frontend Display**:
   - When the frontend application loads or refreshes the distribution list, it shows the updated status from DynamoDB

This automated system ensures that the application always shows the correct status of CloudFront distributions, even if no one is actively viewing the distribution details.

### Benefits

1. **Automatic Updates**: Distribution statuses are updated automatically without requiring user interaction
2. **Efficient Resource Usage**: Only checks distributions that are in non-final states
3. **Scalable**: Can handle many distributions without performance issues
4. **Reliable**: Uses asynchronous invocations to ensure all distributions are processed
5. **Maintainable**: Follows the same patterns as the existing code

## Template Configuration

Templates in CloudFront Manager are stored in DynamoDB and provide reusable CloudFront distribution configurations. Understanding the template structure is essential for creating effective templates.

### Template Structure in DynamoDB

A template in DynamoDB has the following structure:

```json
{
  "templateId": "tmpl-001",
  "name": "Game Assets CDN",
  "description": "Optimized for game assets with high TTL and compression.",
  "category": "Web",
  "createdBy": "admin@example.com",
  "createdAt": "2025-06-25T14:00:00Z",
  "updatedAt": "2025-06-27T12:55:00Z",
  "config": {
    "features": [
      "Compression",
      "WAF",
      "Performance"
    ],
    "Comment": "Game Assets CDN Template",
    "Enabled": true,
    "Origins": {
      "Quantity": 1,
      "Items": [
        {
          "Id": "s3-origin",
          "DomainName": "example-bucket.s3.amazonaws.com",
          "OriginPath": "",
          "S3OriginConfig": {
            "OriginAccessIdentity": ""
          },
          "CustomHeaders": {
            "Quantity": 0
          }
        }
      ]
    },
    "DefaultCacheBehavior": {
      "TargetOriginId": "s3-origin",
      "ViewerProtocolPolicy": "redirect-to-https",
      "AllowedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"],
        "CachedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"]
        }
      },
      "CachePolicyId": "CUSTOM_CACHE_POLICY_ID" // CachingOptimized_CompressionDisabled
    },
    "PriceClass": "PriceClass_100",
    "DefaultRootObject": "index.html"
  }
}
```

### Mandatory Fields

When creating a template, the following fields are mandatory:

1. **Template Metadata**:
   - `templateId`: Unique identifier for the template
   - `name`: Display name of the template
   - `category`: Category for organizing templates (e.g., Web, Download, Streaming)

2. **CloudFront Configuration** (within the `config` object):
   - `Origins`: Configuration for the distribution's origins
     - Must include `Quantity` and `Items` array with at least one origin
     - Each origin must have an `Id` and `DomainName`
     - Either `S3OriginConfig` or `CustomOriginConfig` must be specified
   
   - `DefaultCacheBehavior`: Configuration for the default cache behavior
     - Must include `TargetOriginId` that matches an origin ID
     - Must include `ViewerProtocolPolicy`
     - Must include either `CachePolicyId` or `ForwardedValues` configuration

   - `Enabled`: Boolean indicating whether the distribution should be enabled (typically `true`)

### Optional Fields

The following fields are optional but recommended:

1. **Template Metadata**:
   - `description`: Detailed description of the template's purpose
   - `features`: Array of highlighted features for UI display

2. **CloudFront Configuration**:
   - `Comment`: Description of the distribution
   - `PriceClass`: Price class for the distribution (e.g., `PriceClass_100`)
   - `DefaultRootObject`: Default root object (e.g., `index.html`)
   - `Aliases`: Custom domain names for the distribution
   - `WebACLId`: AWS WAF web ACL ID for the distribution
   - `HttpVersion`: HTTP version to use (e.g., `http2`)
   - `CustomErrorResponses`: Custom error responses configuration
   - `Logging`: Logging configuration

### Best Practices

1. **Use Descriptive Names**: Give templates clear, descriptive names that indicate their purpose
2. **Categorize Templates**: Use consistent categories to organize templates
3. **Document Features**: List key features in the `features` array for easy identification
4. **Use Standard Configurations**: Follow AWS best practices for CloudFront configurations
5. **Test Templates**: Verify that templates create working distributions before sharing them

### Common Issues

1. **Missing Required Fields**: Ensure that all mandatory fields are included in the template
2. **Invalid Origin Configuration**: Either `S3OriginConfig` or `CustomOriginConfig` must be specified for each origin
3. **Invalid Cache Behavior**: The default cache behavior must include either `CachePolicyId` or `ForwardedValues`
4. **Origin Path Format**: If specified, `OriginPath` must start with a forward slash and not end with one

## S3 Origins Management

The CloudFront Manager includes a dedicated Origins management system that allows users to create, view, update, and delete S3 buckets that serve as origins for CloudFront distributions.

### Overview

The S3 Origins management feature provides a user-friendly interface for managing S3 buckets specifically configured for use with CloudFront. This simplifies the process of creating properly configured origins for your distributions.

### Features

1. **Create S3 Origins**:
   - Create new S3 buckets with proper configurations for CloudFront
   - Enable website hosting with custom index and error documents
   - Configure CORS settings for cross-origin requests
   - Set appropriate bucket policies for public access

2. **Manage Existing Origins**:
   - View a list of all S3 origins created through the application
   - Update origin configurations including website hosting and CORS settings
   - Delete origins and their associated S3 buckets when no longer needed

3. **Integration with Distributions**:
   - Use managed origins when creating new CloudFront distributions
   - Ensure consistent configuration across your CDN infrastructure

### How It Works

1. **Origin Creation**:
   - User provides a name, bucket name, and region
   - User configures optional settings like website hosting and CORS
   - System creates the S3 bucket with the specified configuration
   - Origin details are stored in DynamoDB for future reference

2. **Origin Management**:
   - Origins are listed in the Origins tab with key information
   - Users can view detailed configuration of each origin
   - Website hosting and CORS settings can be modified after creation
   - When an origin is deleted, the associated S3 bucket is emptied and removed

3. **Data Storage**:
   - Origin configurations are stored in a dedicated DynamoDB table
   - Each origin record includes:
     - Origin ID (unique identifier)
     - Name (display name)
     - Bucket name
     - Region
     - Website configuration
     - CORS configuration
     - Creation and modification timestamps

### Benefits

1. **Simplified Management**: Manage S3 origins through a user-friendly interface
2. **Proper Configuration**: Ensure S3 buckets are correctly configured for CloudFront
3. **Centralized Control**: Manage all your CloudFront-related resources in one place
4. **Reduced Errors**: Avoid common configuration mistakes when setting up origins
5. **Efficient Workflows**: Streamline the process of creating and managing CDN infrastructure

## Origin Access Control (OAC) Management

The CloudFront Manager implements a comprehensive Origin Access Control (OAC) system that automatically manages secure access between CloudFront distributions and S3 origins. This ensures proper security and access control for your CDN infrastructure.

**Note**: For multi-origin distributions using Lambda@Edge, the system uses Origin Access Identity (OAI) instead of OAC due to Lambda@Edge compatibility requirements.

### Overview

Origin Access Control (OAC) is AWS's recommended method for securing access to S3 origins from CloudFront distributions for single-origin distributions. For multi-origin distributions with Lambda@Edge, Origin Access Identity (OAI) is used to ensure compatibility.

### Architecture: Dual Authentication System

The system implements different authentication methods based on distribution type:

#### **Single-Origin Distributions: One OAC per S3 Origin**
- **Granular Security Control**: Each S3 bucket has its own dedicated OAC
- **Isolation**: Security issues are contained to specific bucket/OAC pairs
- **Flexible Configuration**: Different access policies per S3 bucket
- **Clear Auditability**: Easy mapping between OACs and S3 buckets

#### **Multi-Origin Distributions: Shared OAI for Lambda@Edge Compatibility**
- **Lambda@Edge Compatible**: Uses OAI which is supported by Lambda@Edge functions
- **Shared Authentication**: All origins in a multi-origin distribution use the same OAI
- **Simplified Management**: Single OAI per multi-origin distribution
- **Regional Routing**: Lambda@Edge functions route requests while maintaining secure access

### Automatic Authentication Management

#### **Single-Origin Distribution Flow**

**1. OAC Creation (When S3 Origin is Created)**

When you create a new S3 origin through the CloudFront Manager:

```javascript
// Automatically created OAC configuration
{
  Name: "OAC-bucket-name-timestamp",
  Description: "Origin Access Control for S3 bucket bucket-name",
  OriginAccessControlOriginType: "S3",
  SigningBehavior: "always",
  SigningProtocol: "sigv4"
}
```

**What happens automatically:**
1. ✅ **OAC Creation**: A dedicated OAC is created for the S3 bucket
2. ✅ **OAC ID Storage**: The OAC ID is stored in the origin's DynamoDB record
3. ✅ **S3 Bucket Policy**: Initial bucket policy is configured for CloudFront access
4. ✅ **Distribution Tracking**: Empty array is initialized to track using distributions

#### **Multi-Origin Distribution Flow**

**1. OAI Creation (When Multi-Origin Distribution is Created)**

When you create a multi-origin distribution with Lambda@Edge:

```javascript
// Automatically created OAI configuration
{
  CallerReference: "distribution-name-oai-timestamp",
  Comment: "OAI for multi-origin distribution: distribution-name"
}
```

**What happens automatically:**
1. ✅ **OAI Creation**: A single OAI is created for the entire multi-origin distribution
2. ✅ **Shared Authentication**: All origins in the distribution use the same OAI
3. ✅ **S3 Policy Updates**: All S3 buckets are updated with OAI-based policies
4. ✅ **Lambda@Edge Compatibility**: OAI ensures Lambda@Edge functions work correctly

**2. S3 Bucket Policy Configuration**

For multi-origin distributions, each S3 bucket gets an OAI-based policy that supports multiple OAI principals:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOriginAccessIdentities",
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity OAI-ID-1",
          "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity OAI-ID-2"
        ]
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::bucket-name/*"
    }
  ]
}
```

**Key Features:**
- **Multiple OAI Support**: S3 buckets can be accessed by multiple multi-origin distributions
- **Policy Merging**: New OAI principals are added to existing policies instead of overwriting
- **Mixed Authentication**: Supports both OAC (single-origin) and OAI (multi-origin) on the same bucket
- **Automatic Deduplication**: Prevents duplicate OAI principals in policies

**3. Lambda@Edge Function Configuration**

The generated Lambda@Edge functions use OAI authentication and include proper CloudFront integration:

```javascript
const setRequestOrigin = (request, domainName) => {
    request.origin.s3.authMethod = 'origin-access-identity';
    request.origin.s3.domainName = domainName;
    request.origin.s3.region = domainName.split('.')[2];
    request.headers['host'] = [{ key: 'host', value: domainName }];
};
```

**CloudFront Integration Requirements:**
- **Function Creation**: Lambda function created in us-east-1 region with `Publish: true`
- **Versioned ARN**: CloudFront requires versioned Lambda function ARNs (e.g., `:1`, `:2`)
- **CloudFront Association**: Function associated with distribution's default cache behavior
- **Invoke Permission**: CloudFront granted permission to invoke the Lambda function
- **Active State**: Function must be in "Active" state before CloudFront association

**Automatic Permission Configuration:**
```javascript
// System automatically adds this permission for each Lambda@Edge function
{
  "StatementId": "cloudfront-invoke-timestamp",
  "Action": "lambda:InvokeFunction", 
  "Principal": "edgelambda.amazonaws.com",
  "Effect": "Allow"
}
```

This ensures the CloudFront trigger appears correctly in the AWS Lambda console and enables proper function invocation.

### Authentication Strategy by Use Case

The CloudFront Manager uses different authentication methods based on how origins are used:

| Use Case | Authentication Method | When Applied | Reason |
|----------|----------------------|--------------|---------|
| **Individual Origin Creation** | OAC | Origins API creates OAC | Prepared for single-origin use (most common scenario) |
| **Single-Origin Distribution** | OAC | Uses origin's existing OAC | AWS recommended, modern security |
| **Multi-Origin Distribution** | OAI | Creates new OAI for distribution | Lambda@Edge compatibility requirement |

### Authentication Method Selection

The system automatically chooses the appropriate authentication method:

| Distribution Type | Authentication Method | Reason |
|------------------|----------------------|---------|
| Single-Origin | OAC (Origin Access Control) | AWS recommended, modern security |
| Multi-Origin with Lambda@Edge | OAI (Origin Access Identity) | Lambda@Edge compatibility requirement |

### Multiple Multi-Origin Distributions Sharing Origins

The system supports multiple multi-origin distributions using the same S3 origins through intelligent S3 bucket policy management.

#### **How It Works:**

1. **First Multi-Origin Distribution**:
   ```json
   {
     "Principal": {
       "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E1URK07W5SXT02"
     }
   }
   ```

2. **Second Multi-Origin Distribution (Same Origins)**:
   ```json
   {
     "Principal": {
       "AWS": [
         "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E1URK07W5SXT02",
         "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E2ABC123DEF456"
       ]
     }
   }
   ```

3. **Mixed Authentication (OAC + Multiple OAI)**:
   ```json
   {
     "Statement": [
       {
         "Sid": "AllowOriginAccessIdentities",
         "Principal": {
           "AWS": [
             "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E1URK07W5SXT02",
             "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E2ABC123DEF456"
           ]
         },
         "Action": "s3:GetObject"
       },
       {
         "Sid": "AllowCloudFrontServicePrincipal",
         "Principal": {
           "Service": "cloudfront.amazonaws.com"
         },
         "Action": "s3:GetObject",
         "Condition": {
           "StringEquals": {
             "AWS:SourceArn": "arn:aws:cloudfront::account:distribution/SINGLE-ORIGIN-DIST-ID"
           }
         }
       }
     ]
   }
   ```

#### **Policy Merging Process:**

1. **Read Existing Policy**: System reads current S3 bucket policy
2. **Extract OAI Principals**: Identifies existing OAI principals
3. **Add New Principal**: Adds new OAI principal if not already present
4. **Preserve Other Statements**: Maintains existing OAC and other policy statements
5. **Update Policy**: Applies merged policy to S3 bucket

#### **Benefits:**

- **Shared Origins**: Multiple multi-origin distributions can use the same S3 origins
- **No Access Loss**: Previous distributions maintain access when new ones are created
- **Cost Efficiency**: Reuse existing S3 buckets across multiple distributions
- **Flexible Architecture**: Mix single-origin (OAC) and multi-origin (OAI) distributions on same buckets
- **Automatic Cleanup**: When distributions are deleted, OAI principals are automatically removed from S3 bucket policies

### **OAI Cleanup on Distribution Deletion**

When a multi-origin distribution is deleted, the system automatically cleans up the associated resources:

#### **Cleanup Process:**

1. **Distribution Type Detection**: System identifies if the distribution is multi-origin with OAI
2. **Origin Identification**: Retrieves all origins used by the distribution
3. **Policy Reading**: Reads existing S3 bucket policies for each origin
4. **Principal Removal**: Removes the specific OAI principal from the policy
5. **Policy Update**: Updates the bucket policy with remaining principals
6. **Lambda@Edge Cleanup**: Deletes the associated Lambda@Edge function and its DynamoDB record
7. **Graceful Handling**: Continues deletion even if cleanup fails

#### **Lambda@Edge Function Cleanup:**

When deleting a multi-origin distribution, the system automatically:
- **Identifies Lambda@Edge Function**: Retrieves the function ID from the distribution record
- **Deletes Lambda Function**: Removes the Lambda@Edge function from AWS Lambda (us-east-1 region)
- **Cleans Database Record**: Removes the function record from the Lambda@Edge functions table
- **Handles Missing Functions**: Gracefully handles cases where the function was already deleted
- **Error Resilience**: Continues distribution deletion even if Lambda cleanup fails

#### **Example Cleanup Scenario:**

**Before Deletion (Multiple OAI Principals):**
```json
{
  "Principal": {
    "AWS": [
      "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E1URK07W5SXT02",
      "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E2ABC123DEF456"
    ]
  }
}
```

**After Deletion (Remaining OAI Principal):**
```json
{
  "Principal": {
    "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity E1URK07W5SXT02"
  }
}
```

**Complete Cleanup (No OAI Principals Left):**
```json
{
  "Version": "2012-10-17",
  "Statement": []
}
```

### Security Benefits

#### **Single-Origin Distributions (OAC)**
- **Modern Security**: Uses AWS's latest security recommendations
- **Enhanced Features**: Supports all AWS regions and HTTP methods
- **Better Performance**: Optimized for modern CloudFront features

#### **Multi-Origin Distributions (OAI)**
- **Lambda@Edge Compatibility**: Ensures Lambda@Edge functions work correctly
- **Proven Security**: Established security model with broad compatibility
- **Shared Access**: Simplified management with single OAI per distribution

### Implementation Details

#### **OAC Implementation (Single-Origin)**
```typescript
// CDK implementation for OAC
const oac = new cloudfront.OriginAccessControl(this, 'OriginAccessControl', {
  description: `OAC for S3 bucket ${bucketName}`,
  originAccessControlOriginType: cloudfront.OriginAccessControlOriginType.S3,
  signingBehavior: cloudfront.SigningBehavior.ALWAYS,
  signingProtocol: cloudfront.SigningProtocol.SIGV4
});
```

#### **OAI Implementation (Multi-Origin)**
```javascript
// Runtime OAI creation for multi-origin distributions
const oaiParams = {
  OriginAccessIdentityConfig: {
    CallerReference: `${distributionName}-oai-${Date.now()}`,
    Comment: `OAI for multi-origin distribution: ${distributionName}`
  }
};

const oaiResult = await cloudfrontClient.send(new CreateOriginAccessIdentityCommand(oaiParams));
```

#### **Lambda@Edge Implementation (Multi-Origin)**
```javascript
// Runtime Lambda@Edge creation for multi-origin distributions
const lambdaParams = {
  FunctionName: `${distributionName}-multi-origin-func-${functionId}`,
  Runtime: 'nodejs18.x',
  Role: process.env.LAMBDA_EDGE_EXECUTION_ROLE_ARN,
  Handler: 'index.handler',
  Code: { ZipFile: zipBuffer },
  Description: 'Lambda@Edge function for multi-origin routing',
  Timeout: 5,
  MemorySize: 128,
  Publish: true // Required for Lambda@Edge association
};

const lambdaResult = await lambdaClient.send(new CreateFunctionCommand(lambdaParams));

// Add CloudFront invoke permission
await lambdaClient.send(new AddPermissionCommand({
  FunctionName: functionName,
  StatementId: `cloudfront-invoke-${Date.now()}`,
  Action: 'lambda:InvokeFunction',
  Principal: 'edgelambda.amazonaws.com'
}));
```

**Lambda@Edge Permission Requirements:**
- **Function Creation**: Must be created in us-east-1 region
- **Published Version**: Must use `Publish: true` for versioned ARN
- **CloudFront Permission**: Must grant `edgelambda.amazonaws.com` invoke permission
- **Active State**: Function must be active before CloudFront association
- **Execution Role**: Must have dual service principal trust policy

**IAM Trust Policy for Lambda@Edge:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": [
          "lambda.amazonaws.com",
          "edgelambda.amazonaws.com"
        ]
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### Monitoring and Troubleshooting

#### **Viewing Authentication Information**

1. **In CloudFront Manager UI**:
   - Single-origin: Origin details show associated OAC ID
   - Multi-origin: Distribution details show shared OAI ID

2. **In AWS Console**:
   - CloudFront → Origin Access Control → View OACs (single-origin)
   - CloudFront → Origin Access Identities → View OAIs (multi-origin)
   - S3 → Bucket → Permissions → Bucket Policy

#### **Common Issues and Solutions**

1. **"Access Denied" errors in single-origin distributions**:
   ```
   Issue: S3 bucket policy not properly configured for OAC
   Solution: Check that distribution ARN is in bucket policy
   ```

2. **"Access Denied" errors in multi-origin distributions**:
   ```
   Issue: S3 bucket policy not properly configured for OAI
   Solution: Verify OAI canonical user ID is in bucket policy
   ```

3. **Lambda@Edge authentication errors**:
   ```
   Issue: Trying to use OAC with Lambda@Edge
   Solution: System automatically uses OAI for Lambda@Edge compatibility
   ```

4. **CloudFront trigger not visible in Lambda console**:
   ```
   Issue: Looking at $LATEST version instead of versioned function
   Solution: Check versioned function (:1, :2) in Lambda console, not $LATEST
   Additional: Ensure edgelambda.amazonaws.com invoke permission exists
   ```

5. **Lambda@Edge function association errors**:
   ```
   Issue: Function not in Active state or missing versioned ARN
   Solution: System waits for Active state and ensures versioned ARN format
   ```

#### **Manual Verification**

You can verify authentication configuration using AWS CLI:

```bash
# List OACs (single-origin)
aws cloudfront list-origin-access-controls

# List OAIs (multi-origin)
aws cloudfront list-origin-access-identities

# Check S3 bucket policy
aws s3api get-bucket-policy --bucket bucket-name
```

### Best Practices

1. **Use CloudFront Manager**: Always create distributions through the CloudFront Manager to ensure proper authentication setup

2. **Don't Manual Changes**: Avoid manually modifying OACs/OAIs or S3 bucket policies outside of the system

3. **Monitor Usage**: Regularly review which distributions are using which origins

4. **Clean Up**: Delete unused distributions before attempting to delete origins

5. **Understand the Difference**: 
   - Single-origin distributions use OAC (modern, recommended)
   - Multi-origin distributions use OAI (Lambda@Edge compatible)

This dual authentication system ensures that your CloudFront distributions have secure, properly configured access to S3 origins while maintaining compatibility with Lambda@Edge functions for multi-origin routing.

## CORS Handling

The CloudFront Manager application implements a comprehensive CORS (Cross-Origin Resource Sharing) strategy to ensure secure communication between the frontend and backend components. This is particularly important as the frontend is hosted on a CloudFront distribution while the backend API is served through API Gateway.

### API Gateway CORS Configuration

At the API Gateway level, CORS is configured with the following settings:

```typescript
defaultCorsPreflightOptions: {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
  allowMethods: apigateway.Cors.ALL_METHODS,
  allowHeaders: [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token'
  ],
  maxAge: cdk.Duration.days(1)
}
```

This configuration:
- Allows requests from any origin (`ALL_ORIGINS`)
- Supports all HTTP methods (`ALL_METHODS`)
- Permits necessary headers for AWS authentication
- Caches preflight results for 24 hours to improve performance

### Lambda Function CORS Implementation

Each Lambda function implements consistent CORS handling using the following pattern:

1. **Standardized CORS Headers**:
   ```javascript
   const CORS_HEADERS = {
     'Content-Type': 'application/json',
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
     'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
     'Access-Control-Allow-Credentials': 'true'
   };
   ```

2. **Helper Functions for Consistent Response Formatting**:
   ```javascript
   // Helper function to generate CORS response
   function corsResponse(statusCode, body) {
     return {
       statusCode: statusCode,
       headers: CORS_HEADERS,
       body: JSON.stringify(body)
     };
   }

   // Helper function to handle OPTIONS requests for CORS preflight
   function handleCorsPreflightRequest() {
     return {
       statusCode: 200,
       headers: CORS_HEADERS,
       body: ''
     };
   }
   ```

3. **Explicit OPTIONS Request Handling**:
   ```javascript
   exports.handler = async (event) => {
     // Handle OPTIONS request for CORS preflight
     if (event.httpMethod === 'OPTIONS') {
       return handleCorsPreflightRequest();
     }
     
     // Regular request handling...
   };
   ```

### Proxy Pattern for Complex Operations

For operations that might involve complex processing or multiple steps (like creating distributions or templates), a proxy pattern is implemented:

1. **Proxy Lambda Function**:
   - Handles CORS preflight requests directly
   - Forwards the actual request to a specialized Lambda function
   - Ensures CORS headers are properly applied to the response

2. **Implementation Example**:
   ```javascript
   // Call the actual function
   const result = await lambdaClient.send(new InvokeCommand({
     FunctionName: process.env.TARGET_FUNCTION_NAME,
     InvocationType: 'RequestResponse',
     Payload: Buffer.from(JSON.stringify(event))
   }));
   
   // Parse the response and add CORS headers
   const payload = JSON.parse(Buffer.from(result.Payload).toString());
   return {
     statusCode: payload.statusCode,
     headers: {
       ...CORS_HEADERS,
       ...(payload.headers || {})
     },
     body: payload.body
   };
   ```

### Benefits of This Approach

1. **Consistency**: All API endpoints handle CORS in the same way
2. **Maintainability**: Helper functions reduce code duplication
3. **Security**: Proper CORS configuration prevents unauthorized cross-origin requests
4. **Browser Compatibility**: Explicit handling of OPTIONS requests ensures compatibility with all browsers
5. **Flexibility**: The proxy pattern allows for complex processing while maintaining proper CORS handling

This comprehensive CORS strategy ensures that the CloudFront Manager application works seamlessly across different domains and browsers, providing a secure and reliable user experience.

### Edit Distribution Functionality

**Current Limitation:**
The "Edit Distribution" functionality in the frontend is currently not fully implemented. When clicking the edit button on a distribution, the application fetches the distribution data but only displays it in an alert instead of opening an editable form.

**Root Cause:**
1. There is no edit distribution modal in the HTML, unlike the create distribution functionality which has a dedicated modal
2. The `editDistribution()` function in `main.js` only retrieves the distribution data and displays it as an alert
3. The implementation is a placeholder that doesn't provide an actual editable interface

**How to Fix:**
1. Add an edit distribution modal to the HTML similar to the create-distribution-modal:
   ```html
   <!-- Modal for editing distribution -->
   <div class="modal" id="edit-distribution-modal">
       <div class="modal-content">
           <div class="modal-header">
               <h2>Edit Distribution</h2>
               <button class="close-btn">&times;</button>
           </div>
           <div class="modal-body">
               <!-- Form fields similar to create distribution -->
               <input type="hidden" id="edit-distribution-id">
               <!-- Other form fields -->
           </div>
           <div class="modal-footer">
               <button class="btn-secondary" id="cancel-edit-btn">Cancel</button>
               <button class="btn-primary" id="update-distribution-btn">Update Distribution</button>
           </div>
       </div>
   </div>
   ```

2. Update the `editDistribution()` function in `main.js` to populate and show the modal:
   ```javascript
   function editDistribution(id) {
       apiCall(`/distributions/${id}`)
           .then(response => {
               if (response.success && response.data && response.data.distribution) {
                   const dist = response.data.distribution;
                   
                   // Populate form fields
                   document.getElementById('edit-distribution-id').value = id;
                   document.getElementById('edit-distribution-name').value = dist.name;
                   // Populate other fields
                   
                   // Show the modal
                   document.getElementById('edit-distribution-modal').classList.add('active');
               } else {
                   alert(`Failed to load distribution for editing`);
               }
           })
           .catch(error => {
               console.error('Error editing distribution:', error);
               alert('Failed to load distribution for editing');
           });
   }
   ```

3. Add an event handler for the update button:
   ```javascript
   document.getElementById('update-distribution-btn').addEventListener('click', function() {
       const id = document.getElementById('edit-distribution-id').value;
       // Get values from form fields
       const updatedData = {
           name: document.getElementById('edit-distribution-name').value,
           // Other fields
       };
       
       apiCall(`/distributions/${id}`, 'PUT', updatedData)
           .then(response => {
               if (response.success) {
                   alert('Distribution updated successfully');
                   document.getElementById('edit-distribution-modal').classList.remove('active');
                   // Reload distributions list
                   loadApiData();
               } else {
                   alert(`Failed to update distribution: ${response.error}`);
               }
           })
           .catch(error => {
               console.error('Error updating distribution:', error);
               alert('Failed to update distribution');
           });
   });
   ```

## Custom Cache Policy Implementation

The CloudFront Manager uses a custom cache policy specifically designed for optimal performance while maintaining compatibility with various content types.

### Cache Policy Configuration

**Policy Name**: `CachingOptimized_CompressionDisabled`

**Key Features**:
- **Caching Enabled**: Optimized TTL settings for better performance
- **Compression Disabled**: Both Gzip and Brotli compression are disabled
- **Flexible Content Support**: Works with all content types without compression conflicts

**Technical Specifications**:
```json
{
  "Name": "CachingOptimized_CompressionDisabled",
  "Comment": "Policy with caching enabled. Does not support Gzip and Brotli compression",
  "DefaultTTL": 86400,     // 1 day
  "MaxTTL": 31536000,      // 1 year
  "MinTTL": 0,             // No minimum
  "EnableAcceptEncodingGzip": false,
  "EnableAcceptEncodingBrotli": false,
  "HeaderBehavior": "none",
  "QueryStringBehavior": "none",
  "CookieBehavior": "none"
}
```

### Implementation Details

#### CDK Infrastructure
The custom cache policy is created in the `CfManagerStack`:

```typescript
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
```

#### Lambda Function Integration
Distribution creation automatically uses the custom cache policy:

```javascript
// Environment variable contains the custom cache policy ID
CachePolicyId: process.env.CUSTOM_CACHE_POLICY_ID,
Compress: false // Disabled to match custom cache policy
```

### Benefits

1. **Consistent Performance**: Standardized caching behavior across all distributions
2. **Content Compatibility**: Works with pre-compressed content and dynamic content
3. **Simplified Management**: Automatic application to all new distributions
4. **Optimal TTL Settings**: Balanced caching strategy for various use cases

### Usage

When creating distributions through the CloudFront Manager:

1. **Standardized Configuration**: All distributions use the same standardized cache policy configuration
2. **No Distribution Type Selection**: The frontend no longer includes distribution type selection (Web, Download, Streaming) as all distributions use the unified cache policy
3. **Automatic Application**: All new distributions automatically use the custom cache policy
4. **HTTP/2 and HTTP/3 Support**: All distributions automatically support both HTTP/2 and HTTP/3 protocols for optimal performance
5. **No Configuration Required**: The policy is applied transparently
6. **Consistent Behavior**: All distributions have the same caching characteristics

### Cache Policy Enforcement

The Lambda function implementation ensures that **all distributions use the custom cache policy**, regardless of what configuration is sent from the frontend:

```javascript
// Always use the custom cache policy from environment variable
distributionConfig.DefaultCacheBehavior.CachePolicyId = process.env.CUSTOM_CACHE_POLICY_ID || '658327ea-f89d-4fab-a63d-7e88639e58f6';

// Ensure compression is disabled to match custom cache policy
distributionConfig.DefaultCacheBehavior.Compress = false;

// Always enable HTTP/2 and HTTP/3 support
distributionConfig.HttpVersion = 'http2and3';
```

**Key Points**:
- **Server-side enforcement**: Cache policy decisions are made in the Lambda function, not the frontend
- **Override behavior**: Any cache policy ID sent from the frontend is automatically overridden
- **Environment-driven**: The actual cache policy used comes from the `CUSTOM_CACHE_POLICY_ID` environment variable
- **Consistent application**: All distribution creation requests use the same custom cache policy
- **HTTP/2 and HTTP/3 support**: All distributions automatically support both HTTP/2 and HTTP/3 protocols

This design ensures that:
- ✅ **Security**: Frontend cannot override infrastructure-level cache policy decisions
- ✅ **Consistency**: All distributions use the same optimized cache configuration
- ✅ **Maintainability**: Cache policy changes only require backend environment variable updates
- ✅ **Reliability**: No dependency on frontend configuration for critical infrastructure settings

The custom cache policy ensures optimal performance while maintaining compatibility with various content delivery scenarios.

## To Do List

### Frontend Configuration Management

#### Current Method
The application currently uses **build-time configuration** where the `deploy.sh` script replaces placeholders in `env.js` with actual values from CloudFormation outputs. This approach embeds configuration directly into the frontend build artifacts.

**Limitations:**
- Configuration is baked into client-side code
- Requires redeployment for configuration changes
- Not aligned with AWS Well-Architected Framework best practices

#### Recommended Improvements

**Option 1: Runtime Configuration via API**
- Add a `/api/config` endpoint that returns configuration values
- Frontend loads configuration dynamically at runtime
- Benefits: Better security, no redeployment needed for config changes

**Option 2: AWS Systems Manager Parameter Store**
- Store configuration parameters in AWS Systems Manager Parameter Store
- Create API endpoint to retrieve parameters securely
- Benefits: Centralized config management, version history, fine-grained access control

## Key Takeaways for Lambda@Edge Implementation

### **Most Important Discovery**
**CloudFront triggers appear on versioned Lambda functions (`:1`, `:2`), NOT on `$LATEST`**
- Always check the specific version in AWS Lambda console
- This was the root cause of "missing" CloudFront triggers

### **Essential Requirements for Lambda@Edge**
1. **Region**: Must be created in `us-east-1` region
2. **Versioned ARN**: Use `Publish: true` when creating functions
3. **Dual Trust Policy**: Both `lambda.amazonaws.com` and `edgelambda.amazonaws.com` principals
4. **CloudFront Permission**: `edgelambda.amazonaws.com` invoke permission required
5. **Active State**: Wait for function to be "Active" before CloudFront association

### **Minimum IAM Permissions**
```json
{
  "Effect": "Allow",
  "Action": [
    "lambda:CreateFunction",
    "lambda:PublishVersion", 
    "lambda:AddPermission",
    "lambda:GetFunction",
    "iam:PassRole"
  ],
  "Resource": [
    "arn:aws:lambda:us-east-1:*:function:*-multi-origin-func-*",
    "arn:aws:iam::*:role/LambdaExecutionRole"
  ]
}
```

### **Troubleshooting Checklist**
- ✅ Check versioned function (`:1`) not `$LATEST` in Lambda console
- ✅ Verify function is in us-east-1 region
- ✅ Confirm function state is "Active"
- ✅ Check `edgelambda.amazonaws.com` invoke permission exists
- ✅ Validate dual service principal trust policy
- ✅ Use versioned ARN in CloudFront association

## LICENSE

This library is licensed under the MIT-0 License. See the LICENSE file.

## Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
