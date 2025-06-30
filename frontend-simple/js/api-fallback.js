// This script checks if the API is available and sets a flag to use mock data if it's not

// Function to get API URL dynamically
function getApiUrl() {
    // Try to get from window.CONFIG (loaded from config.json)
    if (window.CONFIG && window.CONFIG.apiUrl) {
        return window.CONFIG.apiUrl;
    }
    
    // Try to get from window.ENV (legacy support)
    if (window.ENV && window.ENV.API_URL) {
        return window.ENV.API_URL;
    }
    
    // Fallback: try to detect from current location
    const currentHost = window.location.hostname;
    if (currentHost.includes('cloudfront.net')) {
        // If we're on CloudFront, try relative API path
        return '/api/';
    }
    
    // Last resort: return null to trigger mock data
    return null;
}

document.addEventListener('DOMContentLoaded', function() {
    // Get API URL
    const apiUrl = getApiUrl();
    
    // Check if we have API URL
    if (!apiUrl) {
        console.warn('API URL not configured. Using mock data.');
        window.USE_MOCK_DATA = true;
        return;
    }
    
    // Store API URL globally for other scripts
    window.API_URL = apiUrl;
    
    // Get the authentication token
    const idToken = localStorage.getItem('idToken');
    if (!idToken) {
        console.warn('No authentication token found. Using mock data.');
        window.USE_MOCK_DATA = true;
        return;
    }
    
    // Test API connection
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    
    fetch(`${baseUrl}/distributions`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        console.log('API connection successful. Using real API data.');
        window.USE_MOCK_DATA = false;
    })
    .catch(error => {
        console.warn('API connection failed:', error);
        console.warn('Using mock data instead.');
        window.USE_MOCK_DATA = true;
        
        // Show a notification to the user
        const notification = document.createElement('div');
        notification.className = 'api-notification';
        notification.innerHTML = `
            <div class="api-notification-content">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Could not connect to API. Using mock data.</span>
                <button class="close-notification">&times;</button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Add event listener to close button
        notification.querySelector('.close-notification').addEventListener('click', function() {
            notification.remove();
        });
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (document.body.contains(notification)) {
                notification.remove();
            }
        }, 10000);
    });
});
