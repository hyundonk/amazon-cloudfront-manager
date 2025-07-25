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
                'cloudfront:UpdateDistribution',
                'cloudfront:ListDistributions',
            ],
            resources: ['*'],
        }));
        // Add Lambda permissions for managing Lambda@Edge function permissions
        updateStatusRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'lambda:AddPermission',
                'lambda:RemovePermission',
                'lambda:GetPolicy',
            ],
            resources: [
                `arn:aws:lambda:us-east-1:${this.account}:function:*-multi-origin-func-*`,
            ],
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
        // Create Lambda layer for Python common utilities (only if using Python runtime)
        let commonUtilsLayer;
        if (props.runtime === 'python') {
            commonUtilsLayer = new lambda.LayerVersion(this, 'CommonUtilsLayer', {
                code: lambda.Code.fromAsset('functions-python/layers/common-utils'),
                compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
                description: 'Common utilities for CloudFront Manager Python functions',
            });
        }
        // Helper function to create Lambda functions based on runtime
        const createLambdaFunction = (id, functionPath, description, role, environment, timeout = cdk.Duration.seconds(30), memorySize = 256) => {
            if (props.runtime === 'python') {
                return new lambda.Function(this, id, {
                    runtime: lambda.Runtime.PYTHON_3_9,
                    handler: 'lambda_function.lambda_handler',
                    code: lambda.Code.fromAsset(`functions-python/${functionPath}`),
                    environment,
                    role,
                    timeout,
                    memorySize,
                    description: `${description} (Python)`,
                    layers: commonUtilsLayer ? [commonUtilsLayer] : undefined,
                });
            }
            else {
                // Node.js runtime
                return new lambda.Function(this, id, {
                    runtime: lambda.Runtime.NODEJS_18_X,
                    handler: 'index.handler',
                    code: lambda.Code.fromAsset(`functions/${functionPath}`),
                    environment,
                    role,
                    timeout,
                    memorySize,
                    description: `${description} (Node.js)`,
                });
            }
        };
        // Create Lambda function to check and update distribution statuses
        const updateStatusFunction = createLambdaFunction('UpdateDistributionStatusFunction', 'distributions/check-status', 'Checks and updates CloudFront distribution status', updateStatusRole, {
            DISTRIBUTIONS_TABLE: props.distributionsTableName,
            HISTORY_TABLE: props.historyTableName,
        }, cdk.Duration.seconds(60), 256);
        // Create Lambda function to find pending distributions
        const findPendingFunction = createLambdaFunction('FindPendingDistributionsFunction', 'distributions/find-pending', 'Finds pending CloudFront distributions for status updates', findPendingRole, {
            DISTRIBUTIONS_TABLE: props.distributionsTableName,
            UPDATE_STATUS_FUNCTION_NAME: updateStatusFunction.functionName,
        }, cdk.Duration.seconds(30), 256);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2YtbWFuYWdlci1zdGF0dXMtbW9uaXRvci1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9jZi1tYW5hZ2VyLXN0YXR1cy1tb25pdG9yLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyxpREFBaUQ7QUFDakQsMkNBQTJDO0FBQzNDLGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFTMUQsTUFBYSwyQkFBNEIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN4RCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXVDO1FBQy9FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDhDQUE4QztRQUM5QyxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDcEUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO1lBQzNELGVBQWUsRUFBRTtnQkFDZixHQUFHLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUFDLDBDQUEwQyxDQUFDO2FBQ3ZGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUNsRSxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7YUFDdkY7U0FDRixDQUFDLENBQUM7UUFFSCxtREFBbUQ7UUFDbkQsZ0JBQWdCLENBQUMsV0FBVyxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUU7Z0JBQ1AsNEJBQTRCO2dCQUM1QiwrQkFBK0I7Z0JBQy9CLDhC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QUN2RCxXQUFXLEVBQUUsbURBQW1EO1lBQ2hFLE9BQU8sRUFBRSxDQUFDLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1NBQzNELENBQUMsQ0FBQztRQUVILDBDQUEwQztRQUMxQyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ2pELEtBQUssRUFBRSxvQkFBb0IsQ0FBQyxXQUFXO1lBQ3ZDLFdBQVcsRUFBRSxnREFBZ0Q7U0FDOUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUNoRCxLQUFLLEVBQUUsbUJBQW1CLENBQUMsV0FBVztZQUN0QyxXQUFXLEVBQUUsZ0RBQWdEO1NBQzlELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWhLRCxrRUFnS0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2ZNYW5hZ2VyU3RhdHVzTW9uaXRvclN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGRpc3RyaWJ1dGlvbnNUYWJsZU5hbWU6IHN0cmluZztcbiAgaGlzdG9yeVRhYmxlTmFtZTogc3RyaW5nO1xuICBydW50aW1lOiAncHl0aG9uJyB8ICdub2RlanMnO1xufVxuXG5leHBvcnQgY2xhc3MgQ2ZNYW5hZ2VyU3RhdHVzTW9uaXRvclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENmTWFuYWdlclN0YXR1c01vbml0b3JTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDcmVhdGUgc2VwYXJhdGUgSUFNIHJvbGVzIGZvciBlYWNoIGZ1bmN0aW9uXG4gICAgY29uc3QgdXBkYXRlU3RhdHVzUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVXBkYXRlU3RhdHVzTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGZpbmRQZW5kaW5nUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmluZFBlbmRpbmdMYW1iZGFSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIENsb3VkRnJvbnQgcGVybWlzc2lvbnMgdG8gdXBkYXRlIHN0YXR1cyByb2xlXG4gICAgdXBkYXRlU3RhdHVzUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjbG91ZGZyb250OkdldERpc3RyaWJ1dGlvbicsXG4gICAgICAgICdjbG91ZGZyb250OlVwZGF0ZURpc3RyaWJ1dGlvbicsXG4gICAgICAgICdjbG91ZGZyb250Okxpc3REaXN0cmlidXRpb25zJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBMYW1iZGEgcGVybWlzc2lvbnMgZm9yIG1hbmFnaW5nIExhbWJkYUBFZGdlIGZ1bmN0aW9uIHBlcm1pc3Npb25zXG4gICAgdXBkYXRlU3RhdHVzUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsYW1iZGE6QWRkUGVybWlzc2lvbicsXG4gICAgICAgICdsYW1iZGE6UmVtb3ZlUGVybWlzc2lvbicsXG4gICAgICAgICdsYW1iZGE6R2V0UG9saWN5JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6bGFtYmRhOnVzLWVhc3QtMToke3RoaXMuYWNjb3VudH06ZnVuY3Rpb246Ki1tdWx0aS1vcmlnaW4tZnVuYy0qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIER5bmFtb0RCIHBlcm1pc3Npb25zIHRvIGJvdGggcm9sZXNcbiAgICBjb25zdCBkeW5hbW9EYlJlc291cmNlcyA9IFtcbiAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS8ke3Byb3BzLmRpc3RyaWJ1dGlvbnNUYWJsZU5hbWV9YCxcbiAgICAgIGBhcm46YXdzOmR5bmFtb2RiOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTp0YWJsZS8ke3Byb3BzLmhpc3RvcnlUYWJsZU5hbWV9YCxcbiAgICBdO1xuXG4gICAgdXBkYXRlU3RhdHVzUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgJ2R5bmFtb2RiOlB1dEl0ZW0nLFxuICAgICAgICAnZHluYW1vZGI6VXBkYXRlSXRlbScsXG4gICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBkeW5hbW9EYlJlc291cmNlcyxcbiAgICB9KSk7XG5cbiAgICBmaW5kUGVuZGluZ1JvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZHluYW1vZGI6U2NhbicsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbZHluYW1vRGJSZXNvdXJjZXNbMF1dLCAgLy8gT25seSBuZWVkIHNjYW4gb24gZGlzdHJpYnV0aW9ucyB0YWJsZVxuICAgIH0pKTtcblxuICAgIC8vIENyZWF0ZSBMYW1iZGEgbGF5ZXIgZm9yIFB5dGhvbiBjb21tb24gdXRpbGl0aWVzIChvbmx5IGlmIHVzaW5nIFB5dGhvbiBydW50aW1lKVxuICAgIGxldCBjb21tb25VdGlsc0xheWVyOiBsYW1iZGEuTGF5ZXJWZXJzaW9uIHwgdW5kZWZpbmVkO1xuICAgIGlmIChwcm9wcy5ydW50aW1lID09PSAncHl0aG9uJykge1xuICAgICAgY29tbW9uVXRpbHNMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdDb21tb25VdGlsc0xheWVyJywge1xuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy1weXRob24vbGF5ZXJzL2NvbW1vbi11dGlscycpLFxuICAgICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5QWVRIT05fM185XSxcbiAgICAgICAgZGVzY3JpcHRpb246ICdDb21tb24gdXRpbGl0aWVzIGZvciBDbG91ZEZyb250IE1hbmFnZXIgUHl0aG9uIGZ1bmN0aW9ucycsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBIZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIExhbWJkYSBmdW5jdGlvbnMgYmFzZWQgb24gcnVudGltZVxuICAgIGNvbnN0IGNyZWF0ZUxhbWJkYUZ1bmN0aW9uID0gKFxuICAgICAgaWQ6IHN0cmluZyxcbiAgICAgIGZ1bmN0aW9uUGF0aDogc3RyaW5nLFxuICAgICAgZGVzY3JpcHRpb246IHN0cmluZyxcbiAgICAgIHJvbGU6IGlhbS5Sb2xlLFxuICAgICAgZW52aXJvbm1lbnQ6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24gPSBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiBudW1iZXIgPSAyNTZcbiAgICApOiBsYW1iZGEuRnVuY3Rpb24gPT4ge1xuICAgICAgaWYgKHByb3BzLnJ1bnRpbWUgPT09ICdweXRob24nKSB7XG4gICAgICAgIHJldHVybiBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGlkLCB7XG4gICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfOSxcbiAgICAgICAgICBoYW5kbGVyOiAnbGFtYmRhX2Z1bmN0aW9uLmxhbWJkYV9oYW5kbGVyJyxcbiAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYGZ1bmN0aW9ucy1weXRob24vJHtmdW5jdGlvblBhdGh9YCksXG4gICAgICAgICAgZW52aXJvbm1lbnQsXG4gICAgICAgICAgcm9sZSxcbiAgICAgICAgICB0aW1lb3V0LFxuICAgICAgICAgIG1lbW9yeVNpemUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGAke2Rlc2NyaXB0aW9ufSAoUHl0aG9uKWAsXG4gICAgICAgICAgbGF5ZXJzOiBjb21tb25VdGlsc0xheWVyID8gW2NvbW1vblV0aWxzTGF5ZXJdIDogdW5kZWZpbmVkLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE5vZGUuanMgcnVudGltZVxuICAgICAgICByZXR1cm4gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCBpZCwge1xuICAgICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoYGZ1bmN0aW9ucy8ke2Z1bmN0aW9uUGF0aH1gKSxcbiAgICAgICAgICBlbnZpcm9ubWVudCxcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIHRpbWVvdXQsXG4gICAgICAgICAgbWVtb3J5U2l6ZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogYCR7ZGVzY3JpcHRpb259IChOb2RlLmpzKWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9uIHRvIGNoZWNrIGFuZCB1cGRhdGUgZGlzdHJpYnV0aW9uIHN0YXR1c2VzXG4gICAgY29uc3QgdXBkYXRlU3RhdHVzRnVuY3Rpb24gPSBjcmVhdGVMYW1iZGFGdW5jdGlvbihcbiAgICAgICdVcGRhdGVEaXN0cmlidXRpb25TdGF0dXNGdW5jdGlvbicsXG4gICAgICAnZGlzdHJpYnV0aW9ucy9jaGVjay1zdGF0dXMnLFxuICAgICAgJ0NoZWNrcyBhbmQgdXBkYXRlcyBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBzdGF0dXMnLFxuICAgICAgdXBkYXRlU3RhdHVzUm9sZSxcbiAgICAgIHtcbiAgICAgICAgRElTVFJJQlVUSU9OU19UQUJMRTogcHJvcHMuZGlzdHJpYnV0aW9uc1RhYmxlTmFtZSxcbiAgICAgICAgSElTVE9SWV9UQUJMRTogcHJvcHMuaGlzdG9yeVRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgICBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICAyNTZcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiB0byBmaW5kIHBlbmRpbmcgZGlzdHJpYnV0aW9uc1xuICAgIGNvbnN0IGZpbmRQZW5kaW5nRnVuY3Rpb24gPSBjcmVhdGVMYW1iZGFGdW5jdGlvbihcbiAgICAgICdGaW5kUGVuZGluZ0Rpc3RyaWJ1dGlvbnNGdW5jdGlvbicsXG4gICAgICAnZGlzdHJpYnV0aW9ucy9maW5kLXBlbmRpbmcnLFxuICAgICAgJ0ZpbmRzIHBlbmRpbmcgQ2xvdWRGcm9udCBkaXN0cmlidXRpb25zIGZvciBzdGF0dXMgdXBkYXRlcycsXG4gICAgICBmaW5kUGVuZGluZ1JvbGUsXG4gICAgICB7XG4gICAgICAgIERJU1RSSUJVVElPTlNfVEFCTEU6IHByb3BzLmRpc3RyaWJ1dGlvbnNUYWJsZU5hbWUsXG4gICAgICAgIFVQREFURV9TVEFUVVNfRlVOQ1RJT05fTkFNRTogdXBkYXRlU3RhdHVzRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgfSxcbiAgICAgIGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIDI1NlxuICAgICk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uIGZvciBmaW5kIHBlbmRpbmcgZnVuY3Rpb24gdG8gaW52b2tlIHVwZGF0ZSBzdGF0dXMgZnVuY3Rpb25cbiAgICB1cGRhdGVTdGF0dXNGdW5jdGlvbi5ncmFudEludm9rZShmaW5kUGVuZGluZ0Z1bmN0aW9uKTtcblxuICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIEV2ZW50IFJ1bGVcbiAgICBjb25zdCBydWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdTY2hlZHVsZWRTdGF0dXNDaGVjaycsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24ubWludXRlcyg1KSksXG4gICAgICBkZXNjcmlwdGlvbjogJ1BlcmlvZGljYWxseSBjaGVjayBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBzdGF0dXMnLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGZpbmRQZW5kaW5nRnVuY3Rpb24pXSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCB0aGUgQVJOcyBvZiB0aGUgTGFtYmRhIGZ1bmN0aW9uc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVcGRhdGVTdGF0dXNGdW5jdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiB1cGRhdGVTdGF0dXNGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBVcGRhdGUgRGlzdHJpYnV0aW9uIFN0YXR1cyBGdW5jdGlvbicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRmluZFBlbmRpbmdGdW5jdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiBmaW5kUGVuZGluZ0Z1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdBUk4gb2YgdGhlIEZpbmQgUGVuZGluZyBEaXN0cmlidXRpb25zIEZ1bmN0aW9uJyxcbiAgICB9KTtcbiAgfVxufVxuIl19