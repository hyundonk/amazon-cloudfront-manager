# CloudFront Manager - Python Lambda Functions

This directory contains Python implementations of the CloudFront Manager Lambda functions, equivalent to the Node.js versions in the `functions/` directory. These functions use boto3 (AWS SDK for Python) instead of AWS SDK v3 for JavaScript.

## Directory Structure

```
functions-python/
├── common/                     # Common utilities (also available as Lambda layer)
│   ├── cors_utils.py          # CORS handling utilities
│   └── aws_clients.py         # AWS client initialization
├── layers/                     # Lambda layers
│   └── common-utils/          # Common utilities layer
│       └── python/            # Layer content
├── distributions/             # Distribution management functions
│   ├── list/                  # List all distributions
│   ├── create/                # Create new distribution
│   ├── get/                   # Get distribution details
│   ├── delete/                # Delete distribution
│   ├── check-status/          # Check distribution status
│   ├── find-pending/          # Find pending distributions
│   ├── invalidate/            # Create cache invalidation
│   └── update/                # Update distribution
├── templates/                 # Template management functions
│   ├── list/                  # List all templates
│   ├── create/                # Create new template
│   ├── get/                   # Get template details
│   ├── delete/                # Delete template
│   ├── update/                # Update template
│   └── apply/                 # Apply template to create distribution
├── origins/                   # S3 origin management functions
│   ├── list/                  # List all origins
│   ├── create/                # Create new S3 origin
│   ├── get/                   # Get origin details
│   ├── delete/                # Delete origin
│   └── update/                # Update origin
├── certificates/              # SSL certificate management functions
│   ├── list/                  # List ACM certificates
│   └── get/                   # Get certificate details
└── lambda-edge/               # Lambda@Edge management functions
    ├── list/                  # List Lambda@Edge functions
    ├── create/                # Create Lambda@Edge function
    ├── get/                   # Get Lambda@Edge function details
    └── preview/               # Preview Lambda@Edge function code
```

## Implementation Status

### ✅ Completed Functions

1. **distributions/list** - List all CloudFront distributions
2. **distributions/get** - Get distribution details with status updates
3. **distributions/create** - Create new CloudFront distribution (basic version)
4. **templates/list** - List all distribution templates
5. **origins/list** - List all S3 origins with pagination
6. **certificates/list** - List ACM certificates with parallel detail fetching

### 🔄 To Be Implemented

1. **distributions/delete** - Delete CloudFront distribution
2. **distributions/check-status** - Check and update distribution status
3. **distributions/find-pending** - Find distributions with pending status
4. **distributions/invalidate** - Create cache invalidation
5. **distributions/update** - Update distribution configuration
6. **templates/create** - Create new template
7. **templates/get** - Get template details
8. **templates/delete** - Delete template
9. **templates/update** - Update template
10. **templates/apply** - Apply template to create distribution
11. **origins/create** - Create new S3 origin with OAC
12. **origins/get** - Get origin details
13. **origins/delete** - Delete origin and associated resources
14. **origins/update** - Update origin configuration
15. **certificates/get** - Get specific certificate details
16. **lambda-edge/*** - All Lambda@Edge management functions

## Key Differences from Node.js Implementation

### 1. **Language and SDK**
- **Python 3.9+** instead of Node.js 18.x
- **boto3** instead of AWS SDK v3
- **Native Python error handling** instead of JavaScript try/catch

### 2. **Function Structure**
```python
# Python structure
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    # Handle CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Function logic
        return cors_response(200, {'success': True, 'data': result})
    except Exception as error:
        return cors_response(500, {'success': False, 'error': str(error)})
```

### 3. **AWS Client Initialization**
```python
# Python - centralized client creation
from aws_clients import get_dynamodb_resource, get_cloudfront_client

dynamodb = get_dynamodb_resource()
cloudfront = get_cloudfront_client()
```

### 4. **Error Handling**
```python
# Python - boto3 exceptions
from botocore.exceptions import ClientError

try:
    response = client.operation()
except ClientError as error:
    error_code = error.response['Error']['Code']
    error_message = error.response['Error']['Message']
```

### 5. **Type Hints**
```python
# Python - comprehensive type hints
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
def cors_response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
```

## Common Utilities

### CORS Utilities (`cors_utils.py`)
- `cors_response()` - Generate CORS-enabled responses
- `handle_cors_preflight()` - Handle OPTIONS requests
- `extract_request_data()` - Parse JSON request body
- `get_path_parameter()` - Extract path parameters
- `get_query_parameter()` - Extract query parameters

### AWS Clients (`aws_clients.py`)
- `get_dynamodb_client()` - DynamoDB client
- `get_dynamodb_resource()` - DynamoDB resource (high-level)
- `get_cloudfront_client()` - CloudFront client (us-east-1)
- `get_s3_client()` - S3 client
- `get_lambda_client()` - Lambda client
- `get_stepfunctions_client()` - Step Functions client
- `get_acm_client()` - ACM client (us-east-1)

## Deployment Considerations

### Lambda Layer
The common utilities are packaged as a Lambda layer for efficient sharing:
```
functions-python/layers/common-utils/python/
├── cors_utils.py
└── aws_clients.py
```

### Runtime Requirements
- **Python 3.9** or later
- **boto3 >= 1.26.0** (included in Lambda runtime)
- **Lambda layer** for common utilities

### Environment Variables
Same environment variables as Node.js functions:
- `DISTRIBUTIONS_TABLE`
- `TEMPLATES_TABLE`
- `ORIGINS_TABLE`
- `HISTORY_TABLE`
- `LAMBDA_EDGE_FUNCTIONS_TABLE`
- `CUSTOM_CACHE_POLICY_ID`
- `STATUS_MONITOR_STATE_MACHINE_ARN`
- `LAMBDA_EDGE_EXECUTION_ROLE_ARN`

## Performance Optimizations

### 1. **Parallel Processing**
```python
# Certificate list function uses ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=10) as executor:
    futures = [executor.submit(get_details, cert) for cert in certificates]
    results = [future.result() for future in futures]
```

### 2. **Connection Reuse**
```python
# AWS clients are initialized once and reused
dynamodb = get_dynamodb_resource()  # Reuses connections
```

### 3. **Efficient JSON Handling**
```python
# Built-in JSON serialization with datetime support
return json.dumps(data, default=str)
```

## Testing

### Local Testing
```bash
# Install dependencies
pip install boto3 pytest moto

# Run tests
python -m pytest tests/
```

### Integration Testing
```python
# Example test structure
import boto3
from moto import mock_dynamodb, mock_cloudfront

@mock_dynamodb
@mock_cloudfront
def test_list_distributions():
    # Test implementation
    pass
```

## Migration Strategy

### Phase 1: Core Functions
1. Deploy Python functions alongside Node.js functions
2. Test Python functions with existing infrastructure
3. Compare performance and functionality

### Phase 2: Gradual Migration
1. Update CDK stack to use Python functions for new endpoints
2. Monitor performance and error rates
3. Migrate high-traffic functions first

### Phase 3: Complete Migration
1. Replace all Node.js functions with Python equivalents
2. Remove Node.js function code
3. Update documentation and deployment scripts

## Benefits of Python Implementation

### 1. **Simplified Error Handling**
- More intuitive exception handling
- Better error message formatting
- Cleaner error propagation

### 2. **Type Safety**
- Comprehensive type hints
- Better IDE support
- Reduced runtime errors

### 3. **Performance**
- Faster cold start times for simple functions
- More efficient memory usage
- Better CPU utilization for I/O-bound operations

### 4. **Maintainability**
- More readable code structure
- Consistent coding patterns
- Better debugging capabilities

### 5. **AWS Integration**
- Native boto3 integration
- Comprehensive AWS service support
- Better documentation and examples

## Limitations

### 1. **Lambda@Edge Compatibility**
- Lambda@Edge only supports Node.js and Python 3.8
- Complex Lambda@Edge functions may need Node.js
- Limited Python runtime features in Lambda@Edge

### 2. **Package Size**
- boto3 is included in Lambda runtime
- Additional packages increase deployment size
- Layer limitations (250MB unzipped)

### 3. **Cold Start Performance**
- Python cold starts can be slower for complex imports
- Node.js may be faster for simple functions
- Optimization required for high-frequency functions

## Next Steps

1. **Complete remaining function implementations**
2. **Add comprehensive unit tests**
3. **Create CDK stack for Python functions**
4. **Performance benchmarking against Node.js**
5. **Documentation and migration guide**
6. **Production deployment and monitoring**
