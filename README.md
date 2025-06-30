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
      "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6"
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

### Overview

Origin Access Control (OAC) is AWS's recommended method for securing access to S3 origins from CloudFront distributions. The CloudFront Manager automatically creates, manages, and deletes OACs as part of the S3 origins lifecycle.

### Architecture: One OAC per S3 Origin

The system implements a **one-OAC-per-S3-origin** approach, providing:

- **Granular Security Control**: Each S3 bucket has its own dedicated OAC
- **Isolation**: Security issues are contained to specific bucket/OAC pairs
- **Flexible Configuration**: Different access policies per S3 bucket
- **Clear Auditability**: Easy mapping between OACs and S3 buckets

### Automatic OAC Lifecycle Management

#### **1. OAC Creation (When S3 Origin is Created)**

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

#### **2. OAC Association (When Distribution is Created)**

When you create a CloudFront distribution using an S3 origin:

**What happens automatically:**
1. ✅ **OAC Lookup**: System finds the OAC ID for the selected S3 origin
2. ✅ **Distribution Configuration**: OAC ID is added to the CloudFront distribution config
3. ✅ **ARN Registration**: Distribution ARN is added to the origin's tracking list
4. ✅ **S3 Policy Update**: Bucket policy is updated to allow the new distribution

```javascript
// Updated S3 bucket policy
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::bucket-name/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": [
            "arn:aws:cloudfront::account:distribution/DIST-ID-1",
            "arn:aws:cloudfront::account:distribution/DIST-ID-2"
          ]
        }
      }
    }
  ]
}
```

#### **3. OAC Disassociation (When Distribution is Deleted)**

When you delete a CloudFront distribution:

**What happens automatically:**
1. ✅ **ARN Removal**: Distribution ARN is removed from origin's tracking list
2. ✅ **S3 Policy Update**: Bucket policy is updated to remove distribution access
3. ✅ **Clean References**: All OAC references to the deleted distribution are cleaned up

#### **4. OAC Deletion (When S3 Origin is Deleted)**

When you delete an S3 origin:

**Safety checks:**
- ❌ **Deletion Blocked**: If distributions are still using the origin
- ✅ **Safe Deletion**: Only proceeds if no distributions are using the origin

**What happens automatically:**
1. ✅ **Usage Validation**: Checks if any distributions are still using the origin
2. ✅ **OAC Deletion**: Deletes the dedicated OAC from CloudFront
3. ✅ **S3 Cleanup**: Empties and deletes the S3 bucket
4. ✅ **Record Cleanup**: Removes the origin record from DynamoDB

### Security Benefits

#### **1. Principle of Least Privilege**
- Each S3 bucket only allows access from specific CloudFront distributions
- No blanket permissions across multiple buckets
- Granular control over which distributions can access which origins

#### **2. Automatic Policy Management**
- S3 bucket policies are automatically updated when distributions are added/removed
- No manual policy management required
- Consistent security configuration across all origins

#### **3. Access Isolation**
- Security issues are contained to specific bucket/distribution pairs
- Easy to revoke access for specific distributions
- Clear audit trail of which distributions access which buckets

### Monitoring and Troubleshooting

#### **Viewing OAC Information**

1. **In CloudFront Manager UI**:
   - Origin details show associated OAC ID
   - Distribution list shows which origins are being used

2. **In AWS Console**:
   - CloudFront → Origin Access Control → View all OACs
   - S3 → Bucket → Permissions → Bucket Policy

#### **Common Issues and Solutions**

1. **"Cannot delete origin - still in use"**:
   ```
   Issue: Trying to delete an origin that has active distributions
   Solution: Delete all distributions using the origin first
   ```

2. **"Access Denied" errors**:
   ```
   Issue: S3 bucket policy not properly configured
   Solution: Check that distribution ARN is in bucket policy
   ```

3. **OAC not found errors**:
   ```
   Issue: OAC was manually deleted outside of CloudFront Manager
   Solution: Recreate the origin to generate a new OAC
   ```

#### **Manual Verification**

You can verify OAC configuration using AWS CLI:

```bash
# List all OACs
aws cloudfront list-origin-access-controls

# Get specific OAC details
aws cloudfront get-origin-access-control --id OAC-ID

# Check S3 bucket policy
aws s3api get-bucket-policy --bucket bucket-name
```

### Best Practices

1. **Use CloudFront Manager**: Always create/delete origins through the CloudFront Manager to ensure proper OAC management

2. **Don't Manual OAC Changes**: Avoid manually modifying OACs or S3 bucket policies outside of the system

3. **Monitor Usage**: Regularly review which distributions are using which origins

4. **Clean Up**: Delete unused distributions before attempting to delete origins

5. **Backup Policies**: Consider backing up S3 bucket policies before making changes

This automated OAC management ensures that your CloudFront distributions have secure, properly configured access to S3 origins without requiring manual policy management.

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

## Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
