#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Origin Distribution Creation Flow Diagram
Korean version using diagram-as-code
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.database import Dynamodb
from diagrams.aws.storage import S3
from diagrams.onprem.client import Users

with Diagram("Multi-Origin Distribution Creation Flow", 
             filename="multi_origin_flow_korean", 
             show=False,
             direction="LR"):
    
    # Participants
    ui = Users("Frontend UI")
    api = APIGateway("API Gateway")
    create_func = Lambda("CreateDistributionFunction")
    cf_api = CloudFront("CloudFront API")
    lambda_api = Lambda("Lambda API\n(us-east-1)")
    s3_api = S3("S3 API")
    ddb = Dynamodb("DynamoDB")
    
    # Flow connections with labels
    ui >> Edge(label="POST /distributions\n{isMultiOrigin: true}") >> api
    api >> Edge(label="JWT validation") >> create_func
    
    create_func >> Edge(label="Validate origins") >> ddb
    create_func >> Edge(label="Create OAI") >> cf_api
    create_func >> Edge(label="Create Lambda@Edge\n- Generate JS code\n- Create ZIP package") >> lambda_api
    create_func >> Edge(label="Create CloudFront\n- Associate Lambda@Edge") >> cf_api
    create_func >> Edge(label="Update bucket policies\n- Add OAI permissions") >> s3_api
    create_func >> Edge(label="Store metadata") >> ddb
    
    create_func >> Edge(label="Success response") >> api
    api >> Edge(label="Distribution created") >> ui
