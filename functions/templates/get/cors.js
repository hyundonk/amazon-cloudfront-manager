/**
 * Helper function to add CORS headers to Lambda responses
 * 
 * @param {number} statusCode - HTTP status code
 * @param {object} body - Response body to be JSON stringified
 * @returns {object} - Response object with CORS headers
 */
function corsResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE'
    },
    body: JSON.stringify(body)
  };
}

module.exports = {
  corsResponse
};
