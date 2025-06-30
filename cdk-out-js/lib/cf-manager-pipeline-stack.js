"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CfManagerPipelineStack = void 0;
const cdk = require("aws-cdk-lib");
const codebuild = require("aws-cdk-lib/aws-codebuild");
const codepipeline = require("aws-cdk-lib/aws-codepipeline");
const codepipeline_actions = require("aws-cdk-lib/aws-codepipeline-actions");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
class CfManagerPipelineStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Artifact bucket for the pipeline
        const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
        });
        // Pipeline
        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            pipelineName: 'CloudFrontManager-Pipeline',
            artifactBucket,
            restartExecutionOnUpdate: true,
        });
        // Source artifact
        const sourceOutput = new codepipeline.Artifact('SourceCode');
        // Add source stage - using GitHub as an example
        // Note: In a real project, you would use a GitHub connection or other source provider
        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.GitHubSourceAction({
                    actionName: 'GitHub_Source',
                    owner: 'GITHUB_OWNER',
                    repo: 'GITHUB_REPO',
                    oauthToken: cdk.SecretValue.secretsManager('github-token'),
                    output: sourceOutput,
                    branch: 'main',
                }),
            ],
        });
        // Build frontend
        const frontendBuildProject = new codebuild.PipelineProject(this, 'FrontendBuild', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': {
                            nodejs: '18',
                        },
                        commands: [
                            'cd frontend',
                            'npm ci',
                        ],
                    },
                    build: {
                        commands: [
                            'npm run build',
                        ],
                    },
                },
                artifacts: {
                    'base-directory': 'frontend/build',
                    files: ['**/*'],
                },
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
            },
        });
        const frontendBuildOutput = new codepipeline.Artifact('FrontendBuildOutput');
        // Build backend
        const backendBuildProject = new codebuild.PipelineProject(this, 'BackendBuild', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': {
                            nodejs: '18',
                        },
                        commands: [
                            'cd functions',
                            'npm ci',
                        ],
                    },
                    build: {
                        commands: [
                            'npm run build',
                            'npm run test',
                        ],
                    },
                },
                artifacts: {
                    'base-directory': 'functions/dist',
                    files: ['**/*'],
                },
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
            },
        });
        const backendBuildOutput = new codepipeline.Artifact('BackendBuildOutput');
        // Add build stage
        pipeline.addStage({
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'BuildFrontend',
                    project: frontendBuildProject,
                    input: sourceOutput,
                    outputs: [frontendBuildOutput],
                }),
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'BuildBackend',
                    project: backendBuildProject,
                    input: sourceOutput,
                    outputs: [backendBuildOutput],
                }),
            ],
        });
        // Deploy frontend
        const frontendDeployProject = new codebuild.PipelineProject(this, 'FrontendDeploy', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    build: {
                        commands: [
                            `aws s3 sync . s3://${props.frontendBucket.bucketName} --delete`,
                            `aws cloudfront create-invalidation --distribution-id ${props.frontendDistribution.distributionId} --paths "/*"`,
                        ],
                    },
                },
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
            },
        });
        // Grant permissions to the frontend deploy project
        props.frontendBucket.grantReadWrite(frontendDeployProject);
        frontendDeployProject.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cloudfront:CreateInvalidation'],
            resources: [`arn:aws:cloudfront::${this.account}:distribution/${props.frontendDistribution.distributionId}`],
        }));
        // Deploy backend (CDK deploy)
        const cdkDeployProject = new codebuild.PipelineProject(this, 'CDKDeploy', {
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    install: {
                        'runtime-versions': {
                            nodejs: '18',
                        },
                        commands: [
                            'npm ci',
                        ],
                    },
                    build: {
                        commands: [
                            'npm run build',
                            'npx cdk deploy CfManagerBackendStack --require-approval never',
                        ],
                    },
                },
            }),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
                privileged: true,
            },
        });
        // Grant CDK deploy permissions
        cdkDeployProject.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'cloudformation:*',
                'iam:*',
                'lambda:*',
                'apigateway:*',
                'dynamodb:*',
                'cognito-idp:*',
                'logs:*',
                's3:*',
                'cloudfront:*',
                'states:*'
            ],
            resources: ['*'],
        }));
        // Add deploy stage
        pipeline.addStage({
            stageName: 'Deploy',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'DeployFrontend',
                    project: frontendDeployProject,
                    input: frontendBuildOutput,
                }),
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'DeployBackend',
                    project: cdkDeployProject,
                    input: backendBuildOutput,
                }),
            ],
        });
        // Outputs
        new cdk.CfnOutput(this, 'PipelineName', {
            value: pipeline.pipelineName,
            description: 'CodePipeline Name'
        });
        new cdk.CfnOutput(this, 'ArtifactBucketName', {
            value: artifactBucket.bucketName,
            description: 'Artifact Bucket Name'
        });
    }
}
exports.CfManagerPipelineStack = CfManagerPipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2YtbWFuYWdlci1waXBlbGluZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL2xpYi9jZi1tYW5hZ2VyLXBpcGVsaW5lLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQyx1REFBdUQ7QUFDdkQsNkRBQTZEO0FBQzdELDZFQUE2RTtBQUM3RSx5Q0FBeUM7QUFFekMsMkNBQTJDO0FBTzNDLE1BQWEsc0JBQXVCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDbkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixtQ0FBbUM7UUFDbkMsTUFBTSxjQUFjLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUMzRCxpQkFBaUIsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUztZQUNqRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO1lBQzFDLFNBQVMsRUFBRSxJQUFJO1NBQ2hCLENBQUMsQ0FBQztRQUVILFdBQVc7UUFDWCxNQUFNLFFBQVEsR0FBRyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUMzRCxZQUFZLEVBQUUsNEJBQTRCO1lBQzFDLGNBQWM7WUFDZCx3QkFBd0IsRUFBRSxJQUFJO1NBQy9CLENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLFlBQVksR0FBRyxJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLENBQUM7UUFFN0QsZ0RBQWdEO1FBQ2hELHNGQUFzRjtRQUN0RixRQUFRLENBQUMsUUFBUSxDQUFDO1lBQ2hCLFNB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QUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxjQUFjLENBQUMsVUFBVTtZQUNoQyxXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTVORCx3REE0TkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZSc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmVfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lLWFjdGlvbnMnO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuXG5pbnRlcmZhY2UgQ2ZNYW5hZ2VyUGlwZWxpbmVTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBmcm9udGVuZEJ1Y2tldDogczMuQnVja2V0O1xuICBmcm9udGVuZERpc3RyaWJ1dGlvbjogY2xvdWRmcm9udC5EaXN0cmlidXRpb247XG59XG5cbmV4cG9ydCBjbGFzcyBDZk1hbmFnZXJQaXBlbGluZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENmTWFuYWdlclBpcGVsaW5lU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQXJ0aWZhY3QgYnVja2V0IGZvciB0aGUgcGlwZWxpbmVcbiAgICBjb25zdCBhcnRpZmFjdEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0FydGlmYWN0QnVja2V0Jywge1xuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFBpcGVsaW5lXG4gICAgY29uc3QgcGlwZWxpbmUgPSBuZXcgY29kZXBpcGVsaW5lLlBpcGVsaW5lKHRoaXMsICdQaXBlbGluZScsIHtcbiAgICAgIHBpcGVsaW5lTmFtZTogJ0Nsb3VkRnJvbnRNYW5hZ2VyLVBpcGVsaW5lJyxcbiAgICAgIGFydGlmYWN0QnVja2V0LFxuICAgICAgcmVzdGFydEV4ZWN1dGlvbk9uVXBkYXRlOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gU291cmNlIGFydGlmYWN0XG4gICAgY29uc3Qgc291cmNlT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgnU291cmNlQ29kZScpO1xuXG4gICAgLy8gQWRkIHNvdXJjZSBzdGFnZSAtIHVzaW5nIEdpdEh1YiBhcyBhbiBleGFtcGxlXG4gICAgLy8gTm90ZTogSW4gYSByZWFsIHByb2plY3QsIHlvdSB3b3VsZCB1c2UgYSBHaXRIdWIgY29ubmVjdGlvbiBvciBvdGhlciBzb3VyY2UgcHJvdmlkZXJcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdTb3VyY2UnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuR2l0SHViU291cmNlQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnR2l0SHViX1NvdXJjZScsXG4gICAgICAgICAgb3duZXI6ICdHSVRIVUJfT1dORVInLCAvLyBSZXBsYWNlIHdpdGggeW91ciBHaXRIdWIgb3duZXJcbiAgICAgICAgICByZXBvOiAnR0lUSFVCX1JFUE8nLCAvLyBSZXBsYWNlIHdpdGggeW91ciBHaXRIdWIgcmVwb1xuICAgICAgICAgIG9hdXRoVG9rZW46IGNkay5TZWNyZXRWYWx1ZS5zZWNyZXRzTWFuYWdlcignZ2l0aHViLXRva2VuJyksIC8vIENyZWF0ZSB0aGlzIHNlY3JldCBpbiBTZWNyZXRzIE1hbmFnZXJcbiAgICAgICAgICBvdXRwdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICBicmFuY2g6ICdtYWluJyxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQnVpbGQgZnJvbnRlbmRcbiAgICBjb25zdCBmcm9udGVuZEJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUGlwZWxpbmVQcm9qZWN0KHRoaXMsICdGcm9udGVuZEJ1aWxkJywge1xuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICAgICAgICB2ZXJzaW9uOiAnMC4yJyxcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgaW5zdGFsbDoge1xuICAgICAgICAgICAgJ3J1bnRpbWUtdmVyc2lvbnMnOiB7XG4gICAgICAgICAgICAgIG5vZGVqczogJzE4JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnY2QgZnJvbnRlbmQnLFxuICAgICAgICAgICAgICAnbnBtIGNpJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ25wbSBydW4gYnVpbGQnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhcnRpZmFjdHM6IHtcbiAgICAgICAgICAnYmFzZS1kaXJlY3RvcnknOiAnZnJvbnRlbmQvYnVpbGQnLFxuICAgICAgICAgIGZpbGVzOiBbJyoqLyonXSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF83XzAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgZnJvbnRlbmRCdWlsZE91dHB1dCA9IG5ldyBjb2RlcGlwZWxpbmUuQXJ0aWZhY3QoJ0Zyb250ZW5kQnVpbGRPdXRwdXQnKTtcblxuICAgIC8vIEJ1aWxkIGJhY2tlbmRcbiAgICBjb25zdCBiYWNrZW5kQnVpbGRQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5QaXBlbGluZVByb2plY3QodGhpcywgJ0JhY2tlbmRCdWlsZCcsIHtcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIGluc3RhbGw6IHtcbiAgICAgICAgICAgICdydW50aW1lLXZlcnNpb25zJzoge1xuICAgICAgICAgICAgICBub2RlanM6ICcxOCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2NkIGZ1bmN0aW9ucycsXG4gICAgICAgICAgICAgICducG0gY2knLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnbnBtIHJ1biBidWlsZCcsXG4gICAgICAgICAgICAgICducG0gcnVuIHRlc3QnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhcnRpZmFjdHM6IHtcbiAgICAgICAgICAnYmFzZS1kaXJlY3RvcnknOiAnZnVuY3Rpb25zL2Rpc3QnLFxuICAgICAgICAgIGZpbGVzOiBbJyoqLyonXSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF83XzAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgYmFja2VuZEJ1aWxkT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgnQmFja2VuZEJ1aWxkT3V0cHV0Jyk7XG5cbiAgICAvLyBBZGQgYnVpbGQgc3RhZ2VcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdCdWlsZCcsXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlQnVpbGRBY3Rpb24oe1xuICAgICAgICAgIGFjdGlvbk5hbWU6ICdCdWlsZEZyb250ZW5kJyxcbiAgICAgICAgICBwcm9qZWN0OiBmcm9udGVuZEJ1aWxkUHJvamVjdCxcbiAgICAgICAgICBpbnB1dDogc291cmNlT3V0cHV0LFxuICAgICAgICAgIG91dHB1dHM6IFtmcm9udGVuZEJ1aWxkT3V0cHV0XSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlQnVpbGRBY3Rpb24oe1xuICAgICAgICAgIGFjdGlvbk5hbWU6ICdCdWlsZEJhY2tlbmQnLFxuICAgICAgICAgIHByb2plY3Q6IGJhY2tlbmRCdWlsZFByb2plY3QsXG4gICAgICAgICAgaW5wdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICBvdXRwdXRzOiBbYmFja2VuZEJ1aWxkT3V0cHV0XSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gRGVwbG95IGZyb250ZW5kXG4gICAgY29uc3QgZnJvbnRlbmREZXBsb3lQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5QaXBlbGluZVByb2plY3QodGhpcywgJ0Zyb250ZW5kRGVwbG95Jywge1xuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICAgICAgICB2ZXJzaW9uOiAnMC4yJyxcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgIGBhd3MgczMgc3luYyAuIHMzOi8vJHtwcm9wcy5mcm9udGVuZEJ1Y2tldC5idWNrZXROYW1lfSAtLWRlbGV0ZWAsXG4gICAgICAgICAgICAgIGBhd3MgY2xvdWRmcm9udCBjcmVhdGUtaW52YWxpZGF0aW9uIC0tZGlzdHJpYnV0aW9uLWlkICR7cHJvcHMuZnJvbnRlbmREaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWR9IC0tcGF0aHMgXCIvKlwiYCxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF83XzAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgdG8gdGhlIGZyb250ZW5kIGRlcGxveSBwcm9qZWN0XG4gICAgcHJvcHMuZnJvbnRlbmRCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoZnJvbnRlbmREZXBsb3lQcm9qZWN0KTtcbiAgICBmcm9udGVuZERlcGxveVByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnY2xvdWRmcm9udDpDcmVhdGVJbnZhbGlkYXRpb24nXSxcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmNsb3VkZnJvbnQ6OiR7dGhpcy5hY2NvdW50fTpkaXN0cmlidXRpb24vJHtwcm9wcy5mcm9udGVuZERpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZH1gXSxcbiAgICB9KSk7XG5cbiAgICAvLyBEZXBsb3kgYmFja2VuZCAoQ0RLIGRlcGxveSlcbiAgICBjb25zdCBjZGtEZXBsb3lQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5QaXBlbGluZVByb2plY3QodGhpcywgJ0NES0RlcGxveScsIHtcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIGluc3RhbGw6IHtcbiAgICAgICAgICAgICdydW50aW1lLXZlcnNpb25zJzoge1xuICAgICAgICAgICAgICBub2RlanM6ICcxOCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ25wbSBjaScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICducG0gcnVuIGJ1aWxkJyxcbiAgICAgICAgICAgICAgJ25weCBjZGsgZGVwbG95IENmTWFuYWdlckJhY2tlbmRTdGFjayAtLXJlcXVpcmUtYXBwcm92YWwgbmV2ZXInLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLlNUQU5EQVJEXzdfMCxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBDREsgZGVwbG95IHBlcm1pc3Npb25zXG4gICAgY2RrRGVwbG95UHJvamVjdC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2xvdWRmb3JtYXRpb246KicsXG4gICAgICAgICdpYW06KicsXG4gICAgICAgICdsYW1iZGE6KicsXG4gICAgICAgICdhcGlnYXRld2F5OionLFxuICAgICAgICAnZHluYW1vZGI6KicsXG4gICAgICAgICdjb2duaXRvLWlkcDoqJyxcbiAgICAgICAgJ2xvZ3M6KicsXG4gICAgICAgICdzMzoqJyxcbiAgICAgICAgJ2Nsb3VkZnJvbnQ6KicsXG4gICAgICAgICdzdGF0ZXM6KidcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBkZXBsb3kgc3RhZ2VcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdEZXBsb3knLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnRGVwbG95RnJvbnRlbmQnLFxuICAgICAgICAgIHByb2plY3Q6IGZyb250ZW5kRGVwbG95UHJvamVjdCxcbiAgICAgICAgICBpbnB1dDogZnJvbnRlbmRCdWlsZE91dHB1dCxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlQnVpbGRBY3Rpb24oe1xuICAgICAgICAgIGFjdGlvbk5hbWU6ICdEZXBsb3lCYWNrZW5kJyxcbiAgICAgICAgICBwcm9qZWN0OiBjZGtEZXBsb3lQcm9qZWN0LFxuICAgICAgICAgIGlucHV0OiBiYWNrZW5kQnVpbGRPdXRwdXQsXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUGlwZWxpbmVOYW1lJywgeyBcbiAgICAgIHZhbHVlOiBwaXBlbGluZS5waXBlbGluZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZGVQaXBlbGluZSBOYW1lJ1xuICAgIH0pO1xuICAgIFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcnRpZmFjdEJ1Y2tldE5hbWUnLCB7IFxuICAgICAgdmFsdWU6IGFydGlmYWN0QnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FydGlmYWN0IEJ1Y2tldCBOYW1lJ1xuICAgIH0pO1xuICB9XG59XG4iXX0=