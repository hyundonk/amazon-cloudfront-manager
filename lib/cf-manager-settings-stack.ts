import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class CfManagerSettingsStack extends cdk.Stack {
  public readonly settingsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Settings table for storing application configuration
    this.settingsTable = new dynamodb.Table(this, 'SettingsTable', {
      tableName: 'cf-manager-settings',
      partitionKey: {
        name: 'settingKey',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Add tags to the table
    cdk.Tags.of(this.settingsTable).add('Project', 'CloudFront-Manager');
    cdk.Tags.of(this.settingsTable).add('Component', 'Settings');

    // Output the table name for use in other stacks
    new cdk.CfnOutput(this, 'SettingsTableName', {
      value: this.settingsTable.tableName,
      description: 'Settings DynamoDB table name',
      exportName: 'CfManagerSettingsTableName'
    });

    new cdk.CfnOutput(this, 'SettingsTableArn', {
      value: this.settingsTable.tableArn,
      description: 'Settings DynamoDB table ARN',
      exportName: 'CfManagerSettingsTableArn'
    });
  }
}
