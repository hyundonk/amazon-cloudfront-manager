#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Certificate Integration Flow Diagram
Korean version using diagram-as-code
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import APIGateway
from diagrams.aws.security import CertificateManager
from diagrams.onprem.client import Users

with Diagram("Certificate Integration Flow", 
             filename="certificate_integration_flow_korean", 
             show=False,
             direction="LR"):
    
    # Participants
    ui = Users("Frontend UI")
    api = APIGateway("API Gateway")
    list_func = Lambda("ListCertificatesFunction")
    get_func = Lambda("GetCertificateFunction")
    acm = CertificateManager("ACM (us-east-1)")
    
    # Certificate listing flow
    ui >> Edge(label="GET /certificates") >> api
    api >> Edge(label="JWT validation") >> list_func
    list_func >> Edge(label="List certificates\n- Filter: ISSUED status\n- CloudFront compatible") >> acm
    acm >> Edge(label="Certificate list") >> list_func
    list_func >> Edge(label="Formatted response") >> api
    api >> Edge(label="Display certificates") >> ui
    
    # Certificate details flow
    ui >> Edge(label="GET /certificates/{arn}") >> api
    api >> Edge(label="Certificate ARN") >> get_func
    get_func >> Edge(label="Describe certificate\n- Detailed information\n- Validation status\n- Domain coverage") >> acm
    acm >> Edge(label="Certificate details") >> get_func
    get_func >> Edge(label="Formatted response") >> api
    api >> Edge(label="Display certificate details") >> ui
