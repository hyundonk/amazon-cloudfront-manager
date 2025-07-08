#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CloudFront Manager API Architecture Diagram
Korean version using diagram-as-code
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.database import Dynamodb
from diagrams.aws.security import Cognito, CertificateManager
from diagrams.aws.storage import S3
from diagrams.aws.integration import StepFunctions
from diagrams.onprem.client import Users

# Set Korean font for proper rendering
graph_attr = {
    "fontsize": "12",
    "bgcolor": "transparent"
}

node_attr = {
    "fontsize": "10"
}

edge_attr = {
    "fontsize": "8"
}

with Diagram("CloudFront Manager API Architecture", 
             filename="api_architecture_korean", 
             show=False,
             direction="TB",
             graph_attr=graph_attr,
             node_attr=node_attr,
             edge_attr=edge_attr):
    
    # Frontend Layer
    with Cluster("Frontend Layer"):
        ui = Users("React SPA Frontend\nStatic Files on S3\nServed via CloudFront")
        auth = Cognito("Cognito Authentication\nJWT Token Management")
    
    # API Gateway Layer
    with Cluster("API Gateway Layer"):
        apigw = APIGateway("API Gateway\nhttps://20dnuxjzrd.execute-api\n.ap-northeast-1.amazonaws.com/api/")
        cors = Lambda("CORS Configuration\nCognito Authorizer")
    
    # Lambda Functions Layer
    with Cluster("Lambda Functions Layer - Python Runtime"):
        dist_funcs = Lambda("Distribution Functions")
        tmpl_funcs = Lambda("Template Functions")
        orig_funcs = Lambda("Origin Functions")
        cert_funcs = Lambda("Certificate Functions")
        edge_funcs = Lambda("Lambda@Edge Functions")
    
    # AWS Backend Services
    with Cluster("AWS Backend Services"):
        cf = CloudFront("CloudFront API")
        s3 = S3("S3 API")
        acm = CertificateManager("Certificate Manager")
        lambda_api = Lambda("Lambda API\nus-east-1")
        ddb = Dynamodb("DynamoDB Tables")
        sfn = StepFunctions("Step Functions")
    
    # Multi-Origin Infrastructure
    with Cluster("Multi-Origin Infrastructure"):
        edge_runtime = Lambda("Lambda@Edge Runtime\nGeographic Routing")
        oai = CloudFront("Origin Access Identity")
        s3_origins = S3("S3 Origins\nMultiple Regions")
    
    # Frontend connections
    ui >> auth
    ui >> apigw
    auth >> apigw
    
    # API Gateway connections
    apigw >> cors
    cors >> [dist_funcs, tmpl_funcs, orig_funcs, cert_funcs, edge_funcs]
    
    # Lambda to AWS services connections
    dist_funcs >> [cf, ddb, lambda_api, s3, sfn]
    tmpl_funcs >> ddb
    orig_funcs >> [s3, ddb]
    cert_funcs >> acm
    edge_funcs >> [lambda_api, ddb]
    
    # Multi-origin connections
    cf >> edge_runtime
    edge_runtime >> oai
    oai >> s3_origins
