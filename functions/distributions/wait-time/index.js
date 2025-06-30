exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  // Extract parameters from the event
  const { status, attempt = 0 } = event;
  
  // Define wait times based on status and attempt number
  let waitSeconds;
  
  if (status === 'InProgress') {
    // For InProgress status, wait longer as CloudFront deployments can take time
    // Increase wait time with each attempt, but cap it at 5 minutes
    waitSeconds = Math.min(60 * (attempt + 1), 300);
  } else {
    // For other statuses, use a shorter wait time
    waitSeconds = 30;
  }
  
  console.log(`Calculated wait time: ${waitSeconds} seconds`);
  
  return {
    waitSeconds,
    attempt: attempt + 1
  };
};
