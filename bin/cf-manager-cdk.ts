#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CfManagerStack } from '../lib/cf-manager-stack';
import { CfManagerFrontendStack } from '../lib/cf-manager-frontend-stack';
import { CfManagerBackendStack } from '../lib/cf-manager-backend-stack';
import { CfManagerStatusMonitorStack } from '../lib/cf-manager-status-monitor-stack';

const app = new cdk.App();

// Get runtime preference from context or command line
// Usage: cdk deploy --context runtime=nodejs (for Node.js)
// Default: Python runtime
const runtime = app.node.tryGetContext('runtime') || 'python';

// Environment configuration
const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION 
};

// Validate runtime option
if (runtime !== 'python' && runtime !== 'nodejs') {
  console.error(`❌ Invalid runtime: ${runtime}. Must be 'python' or 'nodejs'`);
  process.exit(1);
}

console.log(`🚀 Deploying CloudFront Manager with ${runtime.toUpperCase()} runtime`);

// Core stack with DynamoDB tables and Cognito
const coreStack = new CfManagerStack(app, 'CfManagerStack', {
  env,
  description: `CloudFront Manager core stack with DynamoDB tables and Cognito (${runtime} runtime)`
});

// Frontend stack
const frontendStack = new CfManagerFrontendStack(app, 'CfManagerFrontendStack', {
  env,
  description: 'CloudFront Manager frontend stack'
});

// Backend stack with runtime selection
const backendStack = new CfManagerBackendStack(app, 'CfManagerBackendStack', {
  env,
  description: `CloudFront Manager backend stack with API Gateway and Lambda functions (${runtime} runtime)`,
  userPool: coreStack.userPool,
  distributionsTable: coreStack.distributionsTable,
  templatesTable: coreStack.templatesTable,
  historyTable: coreStack.historyTable,
  originsTable: coreStack.originsTable,
  lambdaEdgeFunctionsTable: coreStack.lambdaEdgeFunctionsTable,
  customCachePolicy: coreStack.customCachePolicy,
  runtime: runtime as 'python' | 'nodejs' // Pass runtime to backend stack
});

// Status Monitor stack with runtime selection
const statusMonitorStack = new CfManagerStatusMonitorStack(app, 'CfManagerStatusMonitorStack', {
  env,
  description: `CloudFront Manager status monitoring stack with Step Functions (${runtime} runtime)`,
  distributionsTableName: coreStack.distributionsTable.tableName,
  historyTableName: coreStack.historyTable.tableName,
  runtime: runtime as 'python' | 'nodejs' // Pass runtime to status monitor stack
});

// Add dependency to ensure the core stack is deployed first
statusMonitorStack.addDependency(coreStack);

app.synth();
