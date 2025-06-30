/**
 * CORS utilities for Lambda functions
 * This file provides standardized CORS handling across all Lambda functions
 */

// Standard CORS headers used across all Lambda functions
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Credentials': 'true'
};

/**
 * Helper function to generate CORS response
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body to be JSON stringified
 * @returns {object} - Response object with CORS headers
 */
function corsResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

/**
 * Helper function to handle OPTIONS requests for CORS preflight
 * @returns {object} - Response object for OPTIONS preflight requests
 */
function handleCorsPreflightRequest() {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: ''
  };
}

module.exports = {
  CORS_HEADERS,
  corsResponse,
  handleCorsPreflightRequest
};
