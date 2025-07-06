const { generateFunctionCode, REGION_MAPPING_PRESETS } = require('../generator');

// CORS headers
const CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true'
};

const corsResponse = (statusCode, body) => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

const handleCorsPreflightRequest = () => ({
    statusCode: 200,
    headers: CORS_HEADERS,
    body: ''
});

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return handleCorsPreflightRequest();
    }

    try {
        const body = JSON.parse(event.body);
        const { origins, preset } = body;

        // Validate input
        if (!origins || !preset) {
            return corsResponse(400, {
                success: false,
                error: 'Missing required fields: origins, preset'
            });
        }

        if (!REGION_MAPPING_PRESETS[preset]) {
            return corsResponse(400, {
                success: false,
                error: `Invalid preset: ${preset}`
            });
        }

        // Generate function code
        const codeContent = generateFunctionCode(origins, preset);
        const presetConfig = REGION_MAPPING_PRESETS[preset];

        return corsResponse(200, {
            success: true,
            data: {
                codeContent,
                preset: {
                    name: presetConfig.name,
                    description: presetConfig.description,
                    requiredOrigins: presetConfig.requiredOrigins
                },
                regionMapping: presetConfig.mapping
            }
        });

    } catch (error) {
        console.error('Error generating preview:', error);
        return corsResponse(500, {
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};
