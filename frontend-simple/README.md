# CloudFront Manager - Simple Frontend

This is a simple HTML/CSS/JS frontend for the CloudFront Manager application. It provides a user-friendly interface for managing CloudFront distributions with gaming-focused optimizations.

## Features

- Dashboard with key metrics and recent activity
- CloudFront distributions management
- Distribution templates for quick deployment
- Settings and configuration options
- **Authentication with Amazon Cognito**
- **Real API integration with fallback to mock data**
- **Password change functionality for first-time login**

## Structure

- `index.html` - Main HTML file
- `login.html` - Authentication page
- `css/styles.css` - CSS styles
- `css/login.css` - Login page styles
- `js/main.js` - JavaScript functionality
- `js/auth.js` - Authentication functionality
- `js/env.js` - Environment configuration
- `js/api-fallback.js` - API availability check and fallback mechanism
- `img/` - Images and icons

## API Integration

The frontend connects to the backend API to fetch and manage CloudFront distributions and templates:

1. **Real API Calls**: When the backend is available, the frontend makes real API calls to:
   - List distributions and templates
   - View distribution and template details
   - Create, update, and delete distributions
   - Apply templates to create distributions

2. **Fallback Mechanism**: If the API is not available, the frontend automatically falls back to mock data:
   - Tests API connectivity on page load
   - Shows a notification when using mock data
   - Provides a consistent user experience even without the backend

3. **Loading States**: Visual indicators show when data is being loaded:
   - Page-level loading indicators
   - Global loading overlay for API operations

## Authentication

The application uses Amazon Cognito for authentication. To set up authentication:

1. Deploy the `CfManagerStack` which creates the Cognito User Pool:
   ```bash
   cdk deploy CfManagerStack
   ```

2. Create a user in the Cognito User Pool:
   ```bash
   # Get the User Pool ID
   USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
   
   # Create a user
   aws cognito-idp admin-create-user \
     --user-pool-id $USER_POOL_ID \
     --username admin@example.com \
     --temporary-password 'Temp@123456' \
     --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true
   
   # Add the user to the Administrators group
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id $USER_POOL_ID \
     --username admin@example.com \
     --group-name Administrators
   ```

3. **First-time Login**: When logging in with a temporary password, you'll be prompted to change your password. The application now handles this flow automatically.

4. **Password Reset**: If you forget your password, you can use the "Forgot password?" link on the login page.

## Deployment

To deploy this frontend to your CloudFront Manager S3 bucket and CloudFront distribution, use the provided deployment script:

### Prerequisites

Before running the deployment script, ensure you have:
1. Deployed the required CloudFormation stacks (`CfManagerStack` and `CfManagerFrontendStack`)
2. AWS CLI configured with appropriate permissions
3. The `js/env.js` file exists (copy from `js/env.example.js` if needed)

### Running the Deployment Script

```bash
# Navigate to the frontend directory
cd /path/to/amazon-cloudfront-manager/frontend-simple

# Create the environment configuration file if it doesn't exist
cp js/env.example.js js/env.js

# Make the script executable if needed
chmod +x deploy.sh

# Run the deployment script
./deploy.sh
```

### What the Script Does

The deployment script will:
1. Check if the required CloudFormation stacks are deployed
2. Get the necessary configuration values from CloudFormation outputs (User Pool ID, Client ID, API URL)
3. Update the environment configuration file (`js/env.js`) with actual values
4. Upload all frontend files to the S3 bucket (excluding deployment scripts and backup files)
5. Create a CloudFront invalidation to clear the cache
6. Display the URL where the application is available

### Troubleshooting

If you encounter the error `sed: can't read js/env.js: No such file or directory`:
```bash
# Copy the example environment file
cp js/env.example.js js/env.js
```

Then run the deployment script again.

## Manual Deployment

If you prefer to deploy manually:

```bash
# Get the required configuration values
REGION=$(aws configure get region)
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name CfManagerStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
API_URL=$(aws cloudformation describe-stacks --stack-name CfManagerBackendStack --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)

# Update the environment configuration
sed -i.bak "s|{{REGION}}|$REGION|g" js/env.js
sed -i.bak "s|{{USER_POOL_ID}}|$USER_POOL_ID|g" js/env.js
sed -i.bak "s|{{USER_POOL_CLIENT_ID}}|$USER_POOL_CLIENT_ID|g" js/env.js
sed -i.bak "s|{{API_URL}}|$API_URL|g" js/env.js

# Get the S3 bucket name from CloudFormation outputs
UI_BUCKET=$(aws cloudformation describe-stacks --stack-name CfManagerFrontendStack --query "Stacks[0].Outputs[?OutputKey=='UIBucketName'].OutputValue" --output text)

# Deploy the frontend assets to S3
aws s3 sync ./ s3://$UI_BUCKET --delete --exclude "*.sh" --exclude "*.bak" --exclude ".DS_Store"

# Create CloudFront invalidation to clear the cache
DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name CfManagerFrontendStack --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text)
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"
```

## Development and Testing

You can develop and test the frontend even without the backend API:

1. **Local Development**:
   ```bash
   # Serve the frontend locally
   python -m http.server 8080
   ```

2. **Testing with Mock Data**:
   - The frontend automatically uses mock data if the API is not available
   - You can force the use of mock data by setting `window.USE_MOCK_DATA = true` in the browser console

3. **Testing with Real API**:
   - Deploy the backend stack: `cdk deploy CfManagerBackendStack`
   - Update the environment configuration with the API URL
   - The frontend will automatically connect to the real API

## Next Steps

For a production deployment, consider:

1. Implementing more robust error handling
2. Adding form validation
3. Enhancing the UI with additional features
4. Adding multi-factor authentication
5. Implementing real-time updates with WebSockets
