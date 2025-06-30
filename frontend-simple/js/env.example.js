// Environment configuration template
// Copy this file to env.js and update with your actual values
// Or use config.json for runtime configuration

window.ENV = {
    API_URL: '${API_GATEWAY_URL}',
    AWS_REGION: '${AWS_REGION}',
    ENVIRONMENT: '${ENVIRONMENT}'
};

// Example values:
// window.ENV = {
//     API_URL: 'https://your-api-id.execute-api.region.amazonaws.com/api/',
//     AWS_REGION: 'us-east-1',
//     ENVIRONMENT: 'production'
// };
