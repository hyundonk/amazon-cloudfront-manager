"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CfManagerStatusMonitorStack = void 0;
const cdk = require("aws-cdk-lib");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
class CfManagerStatusMonitorStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create separate IAM roles for each function
        const updateStatusRole = new iam.Role(this, 'UpdateStatusLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        const findPendingRole = new iam.Role(this, 'FindPendingLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Add CloudFront permissions to update status role
        updateStatusRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'cloudfront:GetDistribution',
                'cloudfront:ListDistributions',
            ],
            resources: ['*'],
        }));
        // Add DynamoDB permissions to both roles
        const dynamoDbResources = [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.distributionsTableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.historyTableName}`,
        ];
        updateStatusRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
            ],
            resources: dynamoDbResources,
        }));
        findPendingRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'dynamodb:Scan',
            ],
            resources: [dynamoDbResources[0]], // Only need scan on distributions table
        }));
        // Create Lambda function to check and update distribution statuses
        const updateStatusFunction = new lambda.Function(this, 'UpdateDistributionStatusFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/check-status'),
            timeout: cdk.Duration.seconds(60),
            memorySize: 256,
            role: updateStatusRole,
            environment: {
                DISTRIBUTIONS_TABLE: props.distributionsTableName,
                HISTORY_TABLE: props.historyTableName,
            },
        });
        // Create Lambda function to find pending distributions
        const findPendingFunction = new lambda.Function(this, 'FindPendingDistributionsFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('functions/distributions/find-pending'),
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            role: findPendingRole,
            environment: {
                DISTRIBUTIONS_TABLE: props.distributionsTableName,
                UPDATE_STATUS_FUNCTION_NAME: updateStatusFunction.functionName,
            },
        });
        // Grant permission for find pending function to invoke update status function
        updateStatusFunction.grantInvoke(findPendingFunction);
        // Create CloudWatch Event Rule
        const rule = new events.Rule(this, 'ScheduledStatusCheck', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
            description: 'Periodically check CloudFront distribution status',
            targets: [new targets.LambdaFunction(findPendingFunction)],
        });
        // Output the ARNs of the Lambda functions
        new cdk.CfnOutput(this, 'UpdateStatusFunctionArn', {
            value: updateStatusFunction.functionArn,
            description: 'ARN of the Update Distribution Status Function',
        });
        new cdk.CfnOutput(this, 'FindPendingFunctionArn', {
            value: findPendingFunction.functionArn,
            description: 'ARN of the Find Pending Distributions Function',
        });
    }
}
exports.CfManagerStatusMonitorStack = CfManagerStatusMonitorStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2YtbWFuYWdlci1zdGF0dXMtbW9uaXRvci1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9jZi1tYW5hZ2VyLXN0YXR1cy1tb25pdG9yLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFRMUQsTUFBYSwyQkFBNEIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN4RCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXVDO1FBQy9FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDhDQUE4QztRQUM5QyxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDcEUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO1lBQzNELGVBQWUsRUFBRTtnQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2FBQ3ZGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUNsRSxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7YUFDdkY7U0FDRixDQUFDLENBQUM7UUFFSCxtREFBbUQ7UUFDbkQsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUU7Z0JBQ1AsNEJBQTRCO2dCQUM1Qiw4QkFBOEI7YUFDL0I7WUFD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RUFBRSxvQkFBb0IsQ0FBQyxXQUFXO1lBQ3ZDLFdBQVcsRUFBRSxnREFBZ0Q7U0FDOUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUNoRCxLQUFLLEVBQUUsbUJBQW1CLENBQUMsV0FBVztZQUN0QyxXQUFXLEVBQUUsZ0RBQWdEO1NBQzlELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXBHRCxrRUFvR0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2ZNYW5hZ2VyU3RhdHVzTW9uaXRvclN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRpc3RyaWJ1dGlvbnNUYWJsZU5hbWU6IHN0cmluZztcbiAgaGlzdG9yeVRhYmxlTmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ2ZNYW5hZ2VyU3RhdHVzTW9uaXRvclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENmTWFuYWdlclN0YXR1c01vbml0b3JTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgc2VwYXJhdGUgSUFNIHJvbGVzIGZvciBlYWNoIGZ1bmN0aW9uXG4gICAgY29uc3QgdXBkYXRlU3RhdHVzUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVXBkYXRlU3RhdHVzTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGZpbmRQZW5kaW5nUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmluZFBlbmRpbmdMYW1iZGFSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIENsb3VkRnJvbnQgcGVybWlzc2lvbnMgdG8gdXBkYXRlIHN0YXR1cyByb2xlXG4gICAgdXBkYXRlU3RhdHVzUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjbG91ZGZyb250OkdldERpc3RyaWJ1dGlvbicsXG4gICAgICAgICdjbG91ZGZyb250Okxpc3REaXN0cmlidXRpb25zJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBEeW5hbW9EQiBwZXJtaXNzaW9ucyB0byBib3RoIHJvbGVzXG4gICAgY29uc3QgZHluYW1vRGJSZXNvdXJjZXMgPSBbXG4gICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtwcm9wcy5kaXN0cmlidXRpb25zVGFibGVOYW1lfWAsXG4gICAgICBgYXJuOmF3czpkeW5hbW9kYjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06dGFibGUvJHtwcm9wcy5oaXN0b3J5VGFibGVOYW1lfWAsXG4gICAgXTtcblxuICAgIHVwZGF0ZVN0YXR1c1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZHluYW1vZGI6R2V0SXRlbScsXG4gICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgJ2R5bmFtb2RiOlVwZGF0ZUl0ZW0nLFxuICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogZHluYW1vRGJSZXNvdXJjZXMsXG4gICAgfSkpO1xuXG4gICAgZmluZFBlbmRpbmdSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2R5bmFtb2RiOlNjYW4nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2R5bmFtb0RiUmVzb3VyY2VzWzBdXSwgIC8vIE9ubHkgbmVlZCBzY2FuIG9uIGRpc3RyaWJ1dGlvbnMgdGFibGVcbiAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9uIHRvIGNoZWNrIGFuZCB1cGRhdGUgZGlzdHJpYnV0aW9uIHN0YXR1c2VzXG4gICAgY29uc3QgdXBkYXRlU3RhdHVzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdVcGRhdGVEaXN0cmlidXRpb25TdGF0dXNGdW5jdGlvbicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdmdW5jdGlvbnMvZGlzdHJpYnV0aW9ucy9jaGVjay1zdGF0dXMnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHJvbGU6IHVwZGF0ZVN0YXR1c1JvbGUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBESVNUUklCVVRJT05TX1RBQkxFOiBwcm9wcy5kaXN0cmlidXRpb25zVGFibGVOYW1lLFxuICAgICAgICBISVNUT1JZX1RBQkxFOiBwcm9wcy5oaXN0b3J5VGFibGVOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBMYW1iZGEgZnVuY3Rpb24gdG8gZmluZCBwZW5kaW5nIGRpc3RyaWJ1dGlvbnNcbiAgICBjb25zdCBmaW5kUGVuZGluZ0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRmluZFBlbmRpbmdEaXN0cmlidXRpb25zRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZnVuY3Rpb25zL2Rpc3RyaWJ1dGlvbnMvZmluZC1wZW5kaW5nJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICByb2xlOiBmaW5kUGVuZGluZ1JvbGUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBESVNUUklCVVRJT05TX1RBQkxFOiBwcm9wcy5kaXN0cmlidXRpb25zVGFibGVOYW1lLFxuICAgICAgICBVUERBVEVfU1RBVFVTX0ZVTkNUSU9OX05BTUU6IHVwZGF0ZVN0YXR1c0Z1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uIGZvciBmaW5kIHBlbmRpbmcgZnVuY3Rpb24gdG8gaW52b2tlIHVwZGF0ZSBzdGF0dXMgZnVuY3Rpb25cbiAgICB1cGRhdGVTdGF0dXNGdW5jdGlvbi5ncmFudEludm9rZShmaW5kUGVuZGluZ0Z1bmN0aW9uKTtcblxuICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIEV2ZW50IFJ1bGVcbiAgICBjb25zdCBydWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdTY2hlZHVsZWRTdGF0dXNDaGVjaycsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24ubWludXRlcyg1KSksXG4gICAgICBkZXNjcmlwdGlvbjogJ1BlcmlvZGljYWxseSBjaGVjayBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBzdGF0dXMnLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGZpbmRQZW5kaW5nRnVuY3Rpb24pXSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCB0aGUgQVJOcyBvZiB0aGUgTGFtYmRhIGZ1bmN0aW9uc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVcGRhdGVTdGF0dXNGdW5jdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiB1cGRhdGVTdGF0dXNGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBVcGRhdGUgRGlzdHJpYnV0aW9uIFN0YXR1cyBGdW5jdGlvbicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRmluZFBlbmRpbmdGdW5jdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiBmaW5kUGVuZGluZ0Z1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIEZpbmQgUGVuZGluZyBEaXN0cmlidXRpb25zIEZ1bmN0aW9uJyxcbiAgICB9KTtcbiAgfVxufVxuIl19