import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';

interface CfManagerPipelineStackProps extends cdk.StackProps {
  frontendBucket: s3.Bucket;
  frontendDistribution: cloudfront.Distribution;
}

export class CfManagerPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CfManagerPipelineStackProps) {
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
          owner: 'GITHUB_OWNER', // Replace with your GitHub owner
          repo: 'GITHUB_REPO', // Replace with your GitHub repo
          oauthToken: cdk.SecretValue.secretsManager('github-token'), // Create this secret in Secrets Manager
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
