#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CfManagerStack } from '../lib/cf-manager-stack';
import { CfManagerFrontendStack } from '../lib/cf-manager-frontend-stack';
import { CfManagerBackendStack } from '../lib/cf-manager-backend-stack';
import { CfManagerStatusMonitorStack } from '../lib/cf-manager-status-monitor-stack';

const app = new cdk.App();

// Environment configuration
const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION 
};

// Core stack with DynamoDB tables and Cognito
const coreStack = new CfManagerStack(app, 'CfManagerStack', {
  env,
  description: 'CloudFront Manager core stack with DynamoDB tables and Cognito'
});

// Frontend stack
const frontendStack = new CfManagerFrontendStack(app, 'CfManagerFrontendStack', {
  env,
  description: 'CloudFront Manager frontend stack'
});

// Backend stack
const backendStack = new CfManagerBackendStack(app, 'CfManagerBackendStack', {
  env,
  description: 'CloudFront Manager backend stack with API Gateway and Lambda functions',
  userPool: coreStack.userPool,
  distributionsTable: coreStack.distributionsTable,
  templatesTable: coreStack.templatesTable,
  historyTable: coreStack.historyTable,
  originsTable: coreStack.originsTable,
  customCachePolicy: coreStack.customCachePolicy
});

// Status Monitor stack
const statusMonitorStack = new CfManagerStatusMonitorStack(app, 'CfManagerStatusMonitorStack', {
  env,
  description: 'CloudFront Manager status monitoring stack with Step Functions',
  distributionsTableName: coreStack.distributionsTable.tableName,
  historyTableName: coreStack.historyTable.tableName
});

// Add dependency to ensure the core stack is deployed first
statusMonitorStack.addDependency(coreStack);

app.synth();
