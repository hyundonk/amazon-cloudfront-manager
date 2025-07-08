"""
Preview Lambda@Edge function code - Python implementation
"""
import json
import logging
from typing import Dict, Any

# Import common utilities
import sys
sys.path.append('/opt/python')
from cors_utils import cors_response, handle_cors_preflight, extract_request_data

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import the same region mapping presets and code generation logic
from lambda_edge.create.lambda_function import REGION_MAPPING_PRESETS, generate_function_code

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler to preview Lambda@Edge function code
    
    Args:
        event: Lambda event dictionary
        context: Lambda context object
        
    Returns:
        API Gateway response with CORS headers containing generated code preview
    """
    logger.info(f"Event: {json.dumps(event)}")
    
    # Handle OPTIONS request for CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return handle_cors_preflight()
    
    try:
        # Extract request data
        request_data = extract_request_data(event)
        if not request_data:
            return cors_response(400, {
                'success': False,
                'error': 'Request body is required'
            })
        
        # Validate required fields
        origins = request_data.get('origins')
        preset = request_data.get('preset')
        
        if not origins or not preset:
            return cors_response(400, {
                'success': False,
                'error': 'Missing required fields: origins, preset'
            })
        
        if preset not in REGION_MAPPING_PRESETS:
            return cors_response(400, {
                'success': False,
                'error': f'Invalid preset: {preset}. Available presets: {list(REGION_MAPPING_PRESETS.keys())}'
            })
        
        # Generate function code preview
        try:
            code_content = generate_function_code(origins, preset)
            preset_config = REGION_MAPPING_PRESETS[preset]
            
            logger.info(f"Generated code preview for preset: {preset}")
            
            return cors_response(200, {
                'success': True,
                'data': {
                    'codeContent': code_content,
                    'preset': {
                        'name': preset_config['name'],
                        'description': preset_config['description'],
                        'requiredOrigins': preset_config['requiredOrigins']
                    },
                    'regionMapping': preset_config['mapping'],
                    'metadata': {
                        'totalRegions': len(preset_config['mapping']),
                        'originsProvided': len(origins.get('additional', [])) + 1,
                        'originsRequired': preset_config['requiredOrigins']
                    }
                }
            })
            
        except ValueError as validation_error:
            logger.error(f"Code generation validation error: {validation_error}")
            return cors_response(400, {
                'success': False,
                'error': str(validation_error)
            })
        
    except json.JSONDecodeError as json_error:
        logger.error(f"Invalid JSON in request body: {json_error}")
        return cors_response(400, {
            'success': False,
            'error': 'Invalid JSON in request body'
        })
        
    except Exception as error:
        logger.error(f'Error generating preview: {str(error)}')
        logger.error(f'Error type: {type(error).__name__}')
        
        return cors_response(500, {
            'success': False,
            'error': str(error),
            'details': {
                'errorName': type(error).__name__
            }
        })
