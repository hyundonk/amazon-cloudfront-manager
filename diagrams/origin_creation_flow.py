#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Origin Creation with OAC Flow Diagram
Korean version using diagram-as-code
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.database import Dynamodb
from diagrams.aws.storage import S3
from diagrams.onprem.client import Users

with Diagram("Origin Creation with OAC Flow", 
             filename="origin_creation_flow_korean", 
             show=False,
             direction="LR"):
    
    # Participants
    ui = Users("Frontend UI")
    api = APIGateway("API Gateway")
    create_func = Lambda("CreateOriginFunction")
    s3_api = S3("S3 API")
    cf_api = CloudFront("CloudFront API")
    ddb = Dynamodb("DynamoDB")
    
    # Flow connections with labels
    ui >> Edge(label="POST /origins\n{name, bucketName, region}") >> api
    api >> Edge(label="JWT validation") >> create_func
    
    create_func >> Edge(label="Create S3 bucket\n- Website hosting\n- CORS configuration") >> s3_api
    create_func >> Edge(label="Create OAC\n- Unique OAC for bucket\n- S3 access permissions") >> cf_api
    create_func >> Edge(label="Store origin metadata\n- Origin configuration\n- OAC association") >> ddb
    
    create_func >> Edge(label="Success response") >> api
    api >> Edge(label="Origin created with OAC") >> ui
