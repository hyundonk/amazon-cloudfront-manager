// Global configuration and utility functions

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
    
    // Try to get from global window.API_URL (set by api-fallback.js)
    if (window.API_URL) {
        return window.API_URL;
    }
    
    // Fallback: try to detect from current location
    const currentHost = window.location.hostname;
    if (currentHost.includes('cloudfront.net')) {
        // If we're on CloudFront, try relative API path
        return '/api/';
    }
    
    // Last resort: throw error
    throw new Error('API URL not configured. Please check your configuration.');
}

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first
    checkAuthentication();
    
    // Navigation functionality
    const menuItems = document.querySelectorAll('.sidebar-menu li');
    const pages = document.querySelectorAll('.page');

    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // Remove active class from all menu items
            menuItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked menu item
            this.classList.add('active');
            
            // Show corresponding page
            const pageId = this.getAttribute('data-page') + '-page';
            pages.forEach(page => {
                page.classList.remove('active');
                if (page.id === pageId) {
                    page.classList.add('active');
                }
            });
        });
    });

    // Setup sign out functionality
    setupSignOut();

    // Load API data instead of simulating
    loadApiData();
    
    // Setup origins functionality
    setupOriginsUI();
    
    // Setup templates functionality
    setupTemplatesUI();
    
    // Setup distribution creation modal
    setupDistributionModal();
    
    // Setup certificate refresh buttons
    setupCertificateRefreshButtons();
    
    // Load certificates for dropdowns
    populateCertificateDropdown('certificate-arn');
    populateCertificateDropdown('dist-certificate-arn');
});

// Setup origins UI functionality
function setupOriginsUI() {
    // Modal functionality for origins
    const createOriginBtn = document.getElementById('create-origin-btn');
    const cancelOriginBtn = document.getElementById('cancel-origin-btn');
    const createOriginModal = document.getElementById('create-origin-modal');
    const createOriginSubmitBtn = document.getElementById('create-origin-submit-btn');
    const editOriginModal = document.getElementById('edit-origin-modal');
    const cancelEditOriginBtn = document.getElementById('cancel-edit-origin-btn');
    const updateOriginBtn = document.getElementById('update-origin-btn');
    
    // Website hosting toggle
    const enableWebsite = document.getElementById('enable-website');
    const websiteConfig = document.getElementById('website-config');
    const editEnableWebsite = document.getElementById('edit-enable-website');
    const editWebsiteConfig = document.getElementById('edit-website-config');
    
    // CORS toggle
    const enableCors = document.getElementById('enable-cors');
    const corsConfig = document.getElementById('cors-config');
    const editEnableCors = document.getElementById('edit-enable-cors');
    const editCorsConfig = document.getElementById('edit-cors-config');
    
    if (createOriginBtn) {
        createOriginBtn.addEventListener('click', function() {
            createOriginModal.classList.add('active');
        });
    }
    
    if (cancelOriginBtn) {
        cancelOriginBtn.addEventListener('click', function() {
            createOriginModal.classList.remove('active');
        });
    }
    
    if (cancelEditOriginBtn) {
        cancelEditOriginBtn.addEventListener('click', function() {
            editOriginModal.classList.remove('active');
        });
    }
    
    // Toggle website configuration visibility
    if (enableWebsite) {
        enableWebsite.addEventListener('change', function() {
            websiteConfig.classList.toggle('hidden', !this.checked);
        });
    }
    
    if (editEnableWebsite) {
        editEnableWebsite.addEventListener('change', function() {
            editWebsiteConfig.classList.toggle('hidden', !this.checked);
        });
    }
    
    // Toggle CORS configuration visibility
    if (enableCors) {
        enableCors.addEventListener('change', function() {
            corsConfig.classList.toggle('hidden', !this.checked);
        });
    }
    
    if (editEnableCors) {
        editEnableCors.addEventListener('change', function() {
            editCorsConfig.classList.toggle('hidden', !this.checked);
        });
    }
    
    // Add event handler for the Create Origin submit button
    if (createOriginSubmitBtn) {
        createOriginSubmitBtn.addEventListener('click', function() {
            console.log('Create Origin button clicked');
            
            // Get form values
            const name = document.getElementById('origin-name').value;
            const bucketName = document.getElementById('bucket-name').value;
            const region = document.getElementById('bucket-region').value;
            const isWebsiteEnabled = document.getElementById('enable-website').checked;
            const enableCors = document.getElementById('enable-cors').checked;
            
            // Validate form
            if (!name || !bucketName) {
                alert('Origin Name and Bucket Name are required fields');
                return;
            }
            
            // Prepare website configuration if enabled
            let websiteConfiguration = null;
            if (isWebsiteEnabled) {
                websiteConfiguration = {
                    IndexDocument: {
                        Suffix: document.getElementById('index-document').value || 'index.html'
                    },
                    ErrorDocument: {
                        Key: document.getElementById('error-document').value || 'error.html'
                    }
                };
            }
            
            // Prepare CORS configuration if enabled
            let corsConfiguration = null;
            if (enableCors) {
                const corsOrigins = document.getElementById('cors-origins').value || '*';
                const corsOriginsList = corsOrigins === '*' ? ['*'] : corsOrigins.split(',').map(o => o.trim());
                
                const corsMethods = [];
                document.querySelectorAll('input[name="cors-methods"]:checked').forEach(checkbox => {
                    corsMethods.push(checkbox.value);
                });
                
                corsConfiguration = {
                    CORSRules: [
                        {
                            AllowedOrigins: corsOriginsList,
                            AllowedMethods: corsMethods.length > 0 ? corsMethods : ['GET', 'HEAD'],
                            AllowedHeaders: ['*'],
                            MaxAgeSeconds: 3000
                        }
                    ]
                };
            }
            
            // Prepare origin data
            const originData = {
                name: name,
                bucketName: bucketName,
                region: region,
                isWebsiteEnabled: isWebsiteEnabled,
                websiteConfiguration: websiteConfiguration,
                corsConfiguration: corsConfiguration
            };
            
            console.log('Creating origin with data:', originData);
            
            // Show loading state
            createOriginSubmitBtn.disabled = true;
            createOriginSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
            
            // Call API to create origin
            apiCall('/origins', 'POST', originData)
                .then(response => {
                    if (response.success) {
                        console.log('Origin created successfully:', response.data);
                        alert('Origin created successfully!');
                        
                        // Close modal
                        createOriginModal.classList.remove('active');
                        
                        // Reload origins list
                        loadOrigins();
                    } else {
                        console.error('Failed to create origin:', response.error);
                        alert('Failed to create origin: ' + response.error);
                    }
                })
                .catch(error => {
                    console.error('API error:', error);
                    alert('Failed to create origin: ' + error);
                })
                .finally(() => {
                    // Reset button state
                    createOriginSubmitBtn.disabled = false;
                    createOriginSubmitBtn.innerHTML = 'Create Origin';
                });
        });
    }
    
    // Add event handler for the Update Origin button
    if (updateOriginBtn) {
        updateOriginBtn.addEventListener('click', function() {
            const originId = document.getElementById('edit-origin-id').value;
            
            // Get form values
            const name = document.getElementById('edit-origin-name').value;
            const isWebsiteEnabled = document.getElementById('edit-enable-website').checked;
            const enableCors = document.getElementById('edit-enable-cors').checked;
            
            // Validate form
            if (!name) {
                alert('Origin Name is required');
                return;
            }
            
            // Prepare website configuration if enabled
            let websiteConfiguration = null;
            if (isWebsiteEnabled) {
                websiteConfiguration = {
                    IndexDocument: {
                        Suffix: document.getElementById('edit-index-document').value || 'index.html'
                    },
                    ErrorDocument: {
                        Key: document.getElementById('edit-error-document').value || 'error.html'
                    }
                };
            }
            
            // Prepare CORS configuration if enabled
            let corsConfiguration = null;
            if (enableCors) {
                const corsOrigins = document.getElementById('edit-cors-origins').value || '*';
                const corsOriginsList = corsOrigins === '*' ? ['*'] : corsOrigins.split(',').map(o => o.trim());
                
                const corsMethods = [];
                document.querySelectorAll('input[name="edit-cors-methods"]:checked').forEach(checkbox => {
                    corsMethods.push(checkbox.value);
                });
                
                corsConfiguration = {
                    CORSRules: [
                        {
                            AllowedOrigins: corsOriginsList,
                            AllowedMethods: corsMethods.length > 0 ? corsMethods : ['GET', 'HEAD'],
                            AllowedHeaders: ['*'],
                            MaxAgeSeconds: 3000
                        }
                    ]
                };
            }
            
            // Prepare update data
            const updateData = {
                name: name,
                isWebsiteEnabled: isWebsiteEnabled,
                websiteConfiguration: websiteConfiguration,
                corsConfiguration: corsConfiguration
            };
            
            console.log('Updating origin with data:', updateData);
            
            // Show loading state
            updateOriginBtn.disabled = true;
            updateOriginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
            
            // Call API to update origin
            apiCall(`/origins/${originId}`, 'PUT', updateData)
                .then(response => {
                    if (response.success) {
                        console.log('Origin updated successfully:', response.data);
                        alert('Origin updated successfully!');
                        
                        // Close modal
                        editOriginModal.classList.remove('active');
                        
                        // Reload origins list
                        loadOrigins();
                    } else {
                        console.error('Failed to update origin:', response.error);
                        alert('Failed to update origin: ' + response.error);
                    }
                })
                .catch(error => {
                    console.error('API error:', error);
                    alert('Failed to update origin: ' + error);
                })
                .finally(() => {
                    // Reset button state
                    updateOriginBtn.disabled = false;
                    updateOriginBtn.innerHTML = 'Update Origin';
                });
        });
    }
    
    // Close modals when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === createOriginModal) {
            createOriginModal.classList.remove('active');
        }
        if (event.target === editOriginModal) {
            editOriginModal.classList.remove('active');
        }
    });
    
    // Close modals when clicking the close button
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            createOriginModal.classList.remove('active');
            editOriginModal.classList.remove('active');
        });
    });
}

// Check if user is authenticated
function checkAuthentication() {
    // Load environment configuration
    loadEnvironmentConfig().then(() => {
        if (!window.ENV) {
            console.error('Environment configuration not loaded');
            redirectToLogin();
            return;
        }
        
        const userPool = new AmazonCognitoIdentity.CognitoUserPool({
            UserPoolId: window.ENV.USER_POOL_ID,
            ClientId: window.ENV.USER_POOL_CLIENT_ID
        });
        
        const cognitoUser = userPool.getCurrentUser();
        
        if (cognitoUser != null) {
            cognitoUser.getSession((err, session) => {
                if (err) {
                    console.error('Error getting session:', err);
                    redirectToLogin();
                    return;
                }
                
                if (session.isValid()) {
                    // Update UI with user info
                    cognitoUser.getUserAttributes((err, attributes) => {
                        if (err) {
                            console.error('Error getting user attributes:', err);
                            return;
                        }
                        
                        // Find email attribute
                        const emailAttribute = attributes.find(attr => attr.Name === 'email');
                        if (emailAttribute) {
                            // Update user profile display
                            const userProfileSpan = document.querySelector('.user-profile span');
                            if (userProfileSpan) {
                                userProfileSpan.textContent = emailAttribute.Value;
                            }
                        }
                    });
                    
                    // Store tokens for API calls
                    localStorage.setItem('idToken', session.getIdToken().getJwtToken());
                    localStorage.setItem('accessToken', session.getAccessToken().getJwtToken());
                } else {
                    redirectToLogin();
                }
            });
        } else {
            redirectToLogin();
        }
    }).catch(error => {
        console.error('Failed to load environment config:', error);
        redirectToLogin();
    });
}

// Load environment configuration
async function loadEnvironmentConfig() {
    try {
        const response = await fetch('/js/env.js');
        if (!response.ok) {
            throw new Error('Failed to load environment configuration');
        }
        
        const envText = await response.text();
        // Execute the env.js content to set window.ENV
        eval(envText);
        
        return window.ENV;
    } catch (error) {
        console.error('Error loading environment config:', error);
        throw error;
    }
}

// Redirect to login page
function redirectToLogin() {
    window.location.href = 'login.html';
}

// Setup sign out functionality
function setupSignOut() {
    // Find sign out buttons/links
    const signOutBtn = document.querySelector('.user-menu .user-profile + i');
    const signOutMenuItem = document.querySelector('[id="signout"]');
    
    if (signOutBtn) {
        signOutBtn.addEventListener('click', handleSignOut);
    }
    
    if (signOutMenuItem) {
        signOutMenuItem.addEventListener('click', handleSignOut);
    }
}

// Handle sign out
function handleSignOut() {
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: window.ENV.USER_POOL_ID,
        ClientId: window.ENV.USER_POOL_CLIENT_ID
    });
    
    const cognitoUser = userPool.getCurrentUser();
    
    if (cognitoUser) {
        cognitoUser.signOut();
        localStorage.removeItem('idToken');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        redirectToLogin();
    }
}

// Function to load data from the API
function loadApiData() {
    // Show loading indicators
    document.getElementById('dashboard-page').classList.add('loading');
    document.getElementById('distributions-page').classList.add('loading');
    document.getElementById('origins-page').classList.add('loading');
    document.getElementById('templates-page').classList.add('loading');
    
    // Check if we should use mock data
    if (window.USE_MOCK_DATA) {
        console.log('Using mock data instead of API calls');
        
        // Use mock data for distributions
        setTimeout(() => {
            updateDistributionsUI(mockData.distributions);
            updateDashboardStats(mockData.distributions);
            document.getElementById('dashboard-page').classList.remove('loading');
            document.getElementById('distributions-page').classList.remove('loading');
        }, 800);
        
        // Use mock data for origins
        setTimeout(() => {
            updateOriginsUI(mockData.origins);
            document.getElementById('origins-page').classList.remove('loading');
        }, 900);
        
        // Use mock data for templates
        setTimeout(() => {
            updateTemplatesUI(mockData.templates);
            document.getElementById('templates-page').classList.remove('loading');
        }, 1000);
        
        return;
    }
    
    // Load distributions from real API
    apiCall('/distributions')
        .then(response => {
            if (response.success) {
                // Check if response.data contains a distributions property
                if (response.data && Array.isArray(response.data.distributions)) {
                    updateDistributionsUI(response.data.distributions);
                    updateDashboardStats(response.data.distributions);
                } else {
                    console.error('Unexpected API response format:', response);
                    console.error('Expected response.data.distributions to be an array, got:', typeof response.data?.distributions);
                    showApiError('distributions');
                    // Fall back to mock data
                    updateDistributionsUI(mockData.distributions);
                    updateDashboardStats(mockData.distributions);
                }
            } else {
                console.error('Failed to load distributions:', response.error);
                showApiError('distributions');
                // Fall back to mock data
                updateDistributionsUI(mockData.distributions);
                updateDashboardStats(mockData.distributions);
            }
        })
        .catch(error => {
            console.error('API error:', error);
            showApiError('distributions');
            // Fall back to mock data
            updateDistributionsUI(mockData.distributions);
            updateDashboardStats(mockData.distributions);
        })
        .finally(() => {
            document.getElementById('dashboard-page').classList.remove('loading');
            document.getElementById('distributions-page').classList.remove('loading');
        });
    
    // Load origins from real API
    loadOrigins();
    
    // Load templates from real API
    apiCall('/templates')
        .then(response => {
            if (response.success) {
                // Check if response.data contains a templates property
                if (response.data && Array.isArray(response.data.templates)) {
                    updateTemplatesUI(response.data.templates);
                } else {
                    console.error('Unexpected API response format:', response);
                    console.error('Expected response.data.templates to be an array, got:', typeof response.data?.templates);
                    showApiError('templates');
                    // Fall back to mock data
                    updateTemplatesUI(mockData.templates);
                }
            } else {
                console.error('Failed to load templates:', response.error);
                showApiError('templates');
                // Fall back to mock data
                updateTemplatesUI(mockData.templates);
            }
        })
        .catch(error => {
            console.error('API error:', error);
            showApiError('templates');
            // Fall back to mock data
            updateTemplatesUI(mockData.templates);
        })
        .finally(() => {
            document.getElementById('templates-page').classList.remove('loading');
        });
}

// Update distributions UI with data from API
function updateDistributionsUI(distributions) {
    const tableBody = document.querySelector('#distributions-page .data-table tbody');
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    if (!distributions || distributions.length === 0) {
        // Show empty state
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div>
                        <i class="fas fa-info-circle"></i>
                        <p>No distributions found</p>
                        <button class="btn-primary" id="create-distribution-empty-btn">
                            <i class="fas fa-plus"></i> Create Distribution
                        </button>
                    </div>
                </td>
            </tr>
        `;
        
        // Add event listener to the create button
        const createBtn = document.getElementById('create-distribution-empty-btn');
        if (createBtn) {
            createBtn.addEventListener('click', function() {
                document.getElementById('create-distribution-modal').classList.add('active');
            });
        }
        
        return;
    }
    
    // Add rows for each distribution
    distributions.forEach(dist => {
        const statusClass = getStatusClass(dist.status);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${dist.name || 'N/A'}</td>
            <td>${dist.domainName || 'N/A'}</td>
            <td>${dist.origin || 'N/A'}</td>
            <td><span class="status-badge ${statusClass}">${dist.status || 'Unknown'}</span></td>
            <td>${dist.lastModified || 'N/A'}</td>
            <td class="actions-cell">
                <button class="icon-btn" data-action="view" data-id="${dist.id}"><i class="fas fa-eye"></i></button>
                <button class="icon-btn" data-action="edit" data-id="${dist.id}"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" data-action="delete" data-id="${dist.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Add event listeners to action buttons
    addDistributionActionListeners();
}

// Update templates UI with data from API
function updateTemplatesUI(templates) {
    const templatesGrid = document.querySelector('#templates-page .templates-grid');
    if (!templatesGrid) return;
    
    // Clear existing templates
    templatesGrid.innerHTML = '';
    
    if (!templates || templates.length === 0) {
        // Show empty state
        templatesGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-info-circle"></i>
                <p>No templates found</p>
                <button class="btn-primary">
                    <i class="fas fa-plus"></i> Create Template
                </button>
            </div>
        `;
        return;
    }
    
    // Add template cards
    templates.forEach(template => {
        const card = document.createElement('div');
        card.className = 'template-card';
        
        // Create features HTML
        let featuresHTML = '';
        if (template.features && template.features.length > 0) {
            featuresHTML = template.features.map(feature => 
                `<span class="feature-badge"><i class="fas fa-check"></i> ${feature}</span>`
            ).join('');
        }
        
        card.innerHTML = `
            <div class="template-header">
                <h3>${template.name || 'Unnamed Template'}</h3>
                <span class="template-category">${template.category || 'General'}</span>
            </div>
            <p class="template-description">${template.description || 'No description provided.'}</p>
            <div class="template-features">
                ${featuresHTML}
            </div>
            <div class="template-actions">
                <button class="btn-secondary" data-action="view" data-id="${template.id}">View</button>
                <button class="btn-primary" data-action="apply" data-id="${template.id}">Apply</button>
            </div>
        `;
        
        templatesGrid.appendChild(card);
    });
    
    // Add event listeners to template buttons
    addTemplateActionListeners();
}

// Update dashboard stats based on distributions data
function updateDashboardStats(distributions) {
    if (!distributions) return;
    
    // Count distributions by status
    const stats = {
        total: distributions.length,
        deployed: 0,
        inProgress: 0,
        failed: 0
    };
    
    distributions.forEach(dist => {
        if (dist.status === 'Deployed') stats.deployed++;
        else if (dist.status === 'In Progress') stats.inProgress++;
        else if (dist.status === 'Failed') stats.failed++;
    });
    
    // Update stats on dashboard
    const activeDistributions = document.querySelector('#dashboard-page .stat-number:nth-of-type(1)');
    if (activeDistributions) activeDistributions.textContent = stats.deployed;
    
    const pendingDeployments = document.querySelector('#dashboard-page .stat-number:nth-of-type(3)');
    if (pendingDeployments) pendingDeployments.textContent = stats.inProgress;
    
    // Update recent activity (would normally come from a separate API call)
    // For now, we'll just use the most recent distributions based on lastModified
    updateRecentActivity(distributions);
}

// Update recent activity section on dashboard
function updateRecentActivity(distributions) {
    const activityList = document.querySelector('#dashboard-page .activity-list');
    if (!activityList || !distributions || distributions.length === 0) return;
    
    // Sort distributions by lastModified (newest first)
    const sortedDistributions = [...distributions].sort((a, b) => {
        return new Date(b.lastModified) - new Date(a.lastModified);
    });
    
    // Take the 3 most recent
    const recentDistributions = sortedDistributions.slice(0, 3);
    
    // Clear existing activities
    activityList.innerHTML = '';
    
    // Add activity items
    recentDistributions.forEach(dist => {
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        
        // Determine activity type based on status
        let activityType = 'Updated';
        let iconClass = 'blue';
        let iconName = 'edit';
        
        if (dist.status === 'Deployed' && new Date(dist.lastModified) > new Date(Date.now() - 86400000)) {
            activityType = 'Created';
            iconClass = 'green';
            iconName = 'plus';
        } else if (dist.status === 'In Progress') {
            activityType = 'Deploying';
            iconClass = 'orange';
            iconName = 'clock';
        }
        
        // Format date for display
        const activityDate = formatRelativeTime(new Date(dist.lastModified));
        
        activityItem.innerHTML = `
            <div class="activity-icon ${iconClass}">
                <i class="fas fa-${iconName}"></i>
            </div>
            <div class="activity-details">
                <h4>${activityType} Distribution</h4>
                <p>${dist.name}</p>
                <span class="activity-time">${activityDate}</span>
            </div>
        `;
        
        activityList.appendChild(activityItem);
    });
}

// Format relative time (e.g., "2 hours ago")
function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);
    
    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
    if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
    if (diffDay < 7) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
    
    // For older dates, return the actual date
    return date.toLocaleDateString();
}

// Get CSS class for status badge
function getStatusClass(status) {
    switch (status) {
        case 'Deployed':
            return 'success';
        case 'In Progress':
            return 'warning';
        case 'Failed':
            return 'danger';
        default:
            return '';
    }
}

// Show API error message
function showApiError(section) {
    // You could implement a more sophisticated error handling UI here
    console.error(`Failed to load ${section} data from API`);
    
    // For now, we'll just show an alert
    alert(`Failed to load ${section} data. Please try again later.`);
}

// Add event listeners to distribution action buttons
function addDistributionActionListeners() {
    const actionButtons = document.querySelectorAll('#distributions-page .icon-btn');
    
    actionButtons.forEach(button => {
        button.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            const id = this.getAttribute('data-id');
            
            switch (action) {
                case 'view':
                    viewDistribution(id);
                    break;
                case 'edit':
                    editDistribution(id);
                    break;
                case 'delete':
                    deleteDistribution(id);
                    break;
            }
        });
    });
}

// Add event listeners to template action buttons
function addTemplateActionListeners() {
    const viewButtons = document.querySelectorAll('#templates-page .btn-secondary[data-action="view"]');
    const applyButtons = document.querySelectorAll('#templates-page .btn-primary[data-action="apply"]');
    
    viewButtons.forEach(button => {
        button.addEventListener('click', function() {
            const id = this.getAttribute('data-id');
            viewTemplate(id);
        });
    });
    
    applyButtons.forEach(button => {
        button.addEventListener('click', function() {
            const id = this.getAttribute('data-id');
            applyTemplate(id);
        });
    });
}

// Real API call function
function apiCall(endpoint, method = 'GET', data = null) {
    // Get the authentication token
    const idToken = localStorage.getItem('idToken');
    
    if (!idToken) {
        return Promise.reject({
            success: false,
            error: 'Not authenticated'
        });
    }
    
    // Show loading indicator
    document.body.classList.add('api-loading');
    
    const apiUrl = window.API_URL || getApiUrl();
    
    // Make sure endpoint starts with /
    if (!endpoint.startsWith('/')) {
        endpoint = '/' + endpoint;
    }
    
    // Remove trailing slash from API URL if it exists
    const baseUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    
    // For POST requests, first send an OPTIONS request to handle CORS preflight
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        console.log('Sending preflight OPTIONS request for CORS');
        
        // Create a mock request to trigger the OPTIONS preflight
        fetch(`${baseUrl}${endpoint}`, {
            method: 'OPTIONS',
            headers: {
                'Origin': window.location.origin,
                'Access-Control-Request-Method': method,
                'Access-Control-Request-Headers': 'Authorization,Content-Type'
            }
        }).catch(error => {
            // Ignore errors from OPTIONS request, it's expected to fail in some cases
            console.log('Preflight request completed');
        });
    }
    
    // Add a small delay to ensure OPTIONS request is processed
    return new Promise(resolve => setTimeout(resolve, 500))
        .then(() => {
            return fetch(`${baseUrl}${endpoint}`, {
                method: method,
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json',
                    'Origin': window.location.origin
                },
                body: data ? JSON.stringify(data) : null
            });
        })
        .then(async response => {
            console.log(`API Response Status: ${response.status} ${response.statusText}`);
            
            // Try to get response text first
            const responseText = await response.text();
            console.log('Raw API Response:', responseText);
            
            // Try to parse as JSON
            let responseData;
            try {
                responseData = responseText ? JSON.parse(responseText) : {};
            } catch (parseError) {
                console.error('Failed to parse response as JSON:', parseError);
                console.error('Response text was:', responseText);
                
                // Return error with the raw response
                return {
                    success: false,
                    error: `Invalid JSON response: ${responseText.substring(0, 200)}...`,
                    status: response.status,
                    statusText: response.statusText
                };
            }
            
            // Check if response was successful
            if (!response.ok) {
                console.error(`API Error ${response.status}:`, responseData);
                
                // Return error response
                return {
                    success: false,
                    error: responseData.message || responseData.error || `HTTP ${response.status}: ${response.statusText}`,
                    status: response.status,
                    details: responseData
                };
            }
            
            // Success response
            // If the API already returns a success/data structure, use it directly
            // Otherwise, wrap it in our standard format
            if (responseData && typeof responseData === 'object' && 'success' in responseData) {
                return responseData;
            } else {
                return {
                    success: true,
                    data: responseData
                };
            }
        })
        .catch(error => {
            console.error('API call error:', error);
            return {
                success: false,
                error: error.message || 'Network error occurred'
            };
        })
        .finally(() => {
            // Hide loading indicator
            document.body.classList.remove('api-loading');
        });
}

// View distribution details
function viewDistribution(id) {
    apiCall(`/distributions/${id}`)
        .then(response => {
            if (response.success) {
                // Check if response.data contains a distribution property
                if (response.data && response.data.distribution) {
                    // In a real application, you would show a detailed view
                    // For now, we'll just show an alert with the data
                    alert(`Distribution details for ${id}:\n${JSON.stringify(response.data.distribution, null, 2)}`);
                } else {
                    console.error('Unexpected API response format:', response.data);
                    alert(`Failed to load distribution details: Unexpected response format`);
                }
            } else {
                alert(`Failed to load distribution details: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error viewing distribution:', error);
            alert('Failed to load distribution details');
        });
}

// Edit distribution
function editDistribution(id) {
    apiCall(`/distributions/${id}`)
        .then(response => {
            if (response.success) {
                // Check if response.data contains a distribution property
                if (response.data && response.data.distribution) {
                    // In a real application, you would populate a form with the data
                    // For now, we'll just show an alert
                    alert(`Edit distribution ${id}:\n${JSON.stringify(response.data.distribution, null, 2)}`);
                } else {
                    console.error('Unexpected API response format:', response.data);
                    alert(`Failed to load distribution for editing: Unexpected response format`);
                }
            } else {
                alert(`Failed to load distribution for editing: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error editing distribution:', error);
            alert('Failed to load distribution for editing');
        });
}

// Delete distribution
function deleteDistribution(id) {
    if (confirm('Are you sure you want to delete this distribution?')) {
        apiCall(`/distributions/${id}`, 'DELETE')
            .then(response => {
                if (response.success) {
                    alert('Distribution deleted successfully');
                    // Reload distributions to update the UI
                    apiCall('/distributions')
                        .then(response => {
                            if (response.success) {
                                if (response.data && Array.isArray(response.data.distributions)) {
                                    updateDistributionsUI(response.data.distributions);
                                    updateDashboardStats(response.data.distributions);
                                } else {
                                    console.error('Unexpected API response format:', response.data);
                                    updateDistributionsUI([]);
                                    updateDashboardStats([]);
                                }
                            }
                        });
                } else {
                    alert(`Failed to delete distribution: ${response.error}`);
                }
            })
            .catch(error => {
                console.error('Error deleting distribution:', error);
                alert('Failed to delete distribution');
            });
    }
}

// View template details
function viewTemplate(id) {
    apiCall(`/templates/${id}`)
        .then(response => {
            if (response.success) {
                // In a real application, you would show a detailed view
                // For now, we'll just show an alert with the data
                alert(`Template details for ${id}:\n${JSON.stringify(response.data, null, 2)}`);
            } else {
                alert(`Failed to load template details: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error viewing template:', error);
            alert('Failed to load template details');
        });
}

// Load origins from API
function loadOrigins() {
    document.getElementById('origins-page').classList.add('loading');
    
    apiCall('/origins')
        .then(response => {
            if (response.success) {
                // Check if response.data contains an origins property
                if (response.data && Array.isArray(response.data.origins)) {
                    updateOriginsUI(response.data.origins);
                } else {
                    console.error('Unexpected API response format:', response);
                    console.error('Expected response.data.origins to be an array, got:', typeof response.data?.origins);
                    showApiError('origins');
                    // Fall back to mock data
                    updateOriginsUI(mockData.origins || []);
                }
            } else {
                console.error('Failed to load origins:', response.error);
                showApiError('origins');
                // Fall back to mock data
                updateOriginsUI(mockData.origins || []);
            }
        })
        .catch(error => {
            console.error('API error:', error);
            showApiError('origins');
            // Fall back to mock data
            updateOriginsUI(mockData.origins || []);
        })
        .finally(() => {
            document.getElementById('origins-page').classList.remove('loading');
        });
}

// Update origins UI with data from API
function updateOriginsUI(origins) {
    const tableBody = document.querySelector('#origins-page .data-table tbody');
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    if (!origins || origins.length === 0) {
        // Show empty state
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div>
                        <i class="fas fa-info-circle"></i>
                        <p>No origins found</p>
                        <button class="btn-primary" id="create-origin-empty-btn">
                            <i class="fas fa-plus"></i> Create Origin
                        </button>
                    </div>
                </td>
            </tr>
        `;
        
        // Add event listener to the create button
        const createBtn = document.getElementById('create-origin-empty-btn');
        if (createBtn) {
            createBtn.addEventListener('click', function() {
                document.getElementById('create-origin-modal').classList.add('active');
            });
        }
        
        return;
    }
    
    // Add rows for each origin
    origins.forEach(origin => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${origin.name || 'N/A'}</td>
            <td>${origin.bucketName || 'N/A'}</td>
            <td>${origin.region || 'N/A'}</td>
            <td>${origin.isWebsiteEnabled ? '<span class="status-badge success">Enabled</span>' : '<span class="status-badge">Disabled</span>'}</td>
            <td>${origin.createdAt || 'N/A'}</td>
            <td class="actions-cell">
                <button class="icon-btn" data-action="view" data-id="${origin.id}"><i class="fas fa-eye"></i></button>
                <button class="icon-btn" data-action="edit" data-id="${origin.id}"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" data-action="delete" data-id="${origin.id}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Add event listeners to action buttons
    addOriginActionListeners();
}

// Add event listeners to origin action buttons
function addOriginActionListeners() {
    const actionButtons = document.querySelectorAll('#origins-page .icon-btn');
    
    actionButtons.forEach(button => {
        button.addEventListener('click', function() {
            const action = this.getAttribute('data-action');
            const id = this.getAttribute('data-id');
            
            switch (action) {
                case 'view':
                    viewOrigin(id);
                    break;
                case 'edit':
                    editOrigin(id);
                    break;
                case 'delete':
                    deleteOrigin(id);
                    break;
            }
        });
    });
}

// View origin details
function viewOrigin(id) {
    apiCall(`/origins/${id}`)
        .then(response => {
            if (response.success) {
                // In a real application, you would show a detailed view
                // For now, we'll just show an alert with the data
                alert(`Origin details for ${id}:\n${JSON.stringify(response.data.origin, null, 2)}`);
            } else {
                alert(`Failed to load origin details: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error viewing origin:', error);
            alert('Failed to load origin details');
        });
}

// Edit origin
function editOrigin(id) {
    apiCall(`/origins/${id}`)
        .then(response => {
            if (response.success) {
                const origin = response.data.origin;
                
                // Populate form fields
                document.getElementById('edit-origin-id').value = id;
                document.getElementById('edit-origin-name').value = origin.name || '';
                document.getElementById('edit-bucket-name').value = origin.bucketName || '';
                document.getElementById('edit-bucket-region').value = origin.region || '';
                
                // Set website hosting checkbox
                const isWebsiteEnabled = origin.isWebsiteEnabled || false;
                document.getElementById('edit-enable-website').checked = isWebsiteEnabled;
                
                // Show/hide website config section
                document.getElementById('edit-website-config').classList.toggle('hidden', !isWebsiteEnabled);
                
                // Populate website config if available
                if (origin.websiteConfiguration) {
                    document.getElementById('edit-index-document').value = 
                        origin.websiteConfiguration.IndexDocument?.Suffix || 'index.html';
                    document.getElementById('edit-error-document').value = 
                        origin.websiteConfiguration.ErrorDocument?.Key || 'error.html';
                }
                
                // Set CORS checkbox
                const hasCors = origin.corsConfiguration && 
                               origin.corsConfiguration.CORSRules && 
                               origin.corsConfiguration.CORSRules.length > 0;
                document.getElementById('edit-enable-cors').checked = hasCors;
                
                // Show/hide CORS config section
                document.getElementById('edit-cors-config').classList.toggle('hidden', !hasCors);
                
                // Populate CORS config if available
                if (hasCors) {
                    const corsRule = origin.corsConfiguration.CORSRules[0];
                    document.getElementById('edit-cors-origins').value = 
                        corsRule.AllowedOrigins.join(',');
                    
                    // Check appropriate method checkboxes
                    document.querySelectorAll('input[name="edit-cors-methods"]').forEach(checkbox => {
                        checkbox.checked = corsRule.AllowedMethods.includes(checkbox.value);
                    });
                }
                
                // Show the modal
                document.getElementById('edit-origin-modal').classList.add('active');
            } else {
                alert(`Failed to load origin for editing: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error editing origin:', error);
            alert('Failed to load origin for editing');
        });
}

// Delete origin
function deleteOrigin(id) {
    if (confirm('Are you sure you want to delete this origin? This will also delete the S3 bucket and all its contents.')) {
        apiCall(`/origins/${id}`, 'DELETE')
            .then(response => {
                if (response.success) {
                    alert('Origin deleted successfully');
                    // Reload origins to update the UI
                    loadOrigins();
                } else {
                    alert(`Failed to delete origin: ${response.error}`);
                }
            })
            .catch(error => {
                console.error('Error deleting origin:', error);
                alert('Failed to delete origin');
            });
    }
}

// Apply template to create a distribution
function applyTemplate(id) {
    // Prompt the user for a distribution name
    const name = prompt('Enter a name for the new distribution:');
    
    // Check if the user canceled the prompt or entered an empty name
    if (!name) {
        alert('Distribution name is required. Template application canceled.');
        return;
    }
    
    // Prepare the request data
    const data = {
        name: name,
        parameters: {
            // You can add additional parameters here if needed
        }
    };
    
    apiCall(`/templates/${id}/apply`, 'POST', data)
        .then(response => {
            if (response.success) {
                alert('Template applied successfully. Distribution is being created.');
                // Reload distributions to update the UI
                apiCall('/distributions')
                    .then(response => {
                        if (response.success) {
                            if (response.data && Array.isArray(response.data.distributions)) {
                                updateDistributionsUI(response.data.distributions);
                                updateDashboardStats(response.data.distributions);
                            } else {
                                console.error('Unexpected API response format:', response.data);
                            }
                        }
                    });
            } else {
                alert(`Failed to apply template: ${response.error}`);
            }
        })
        .catch(error => {
            console.error('Error applying template:', error);
            alert('Failed to apply template');
        });
}

// Populate origin dropdown for distribution creation
function populateOriginDropdown(selectId = 'origin-domain') {
    const select = document.getElementById(selectId);
    if (!select) return Promise.resolve([]);
    
    // Show loading state
    select.classList.add('loading');
    select.innerHTML = '<option value="">Loading origins...</option>';
    
    return apiCall('/origins')
        .then(response => {
            if (response.success) {
                // Clear loading state
                select.classList.remove('loading');
                select.innerHTML = '<option value="">Select an origin...</option>';
                
                // Add origin options
                response.data.origins.forEach(origin => {
                    const option = document.createElement('option');
                    option.value = origin.bucketName + '.s3.amazonaws.com';
                    option.setAttribute('data-origin-id', origin.id); // Fixed: use origin.id instead of origin.originId
                    option.setAttribute('data-bucket-name', origin.bucketName);
                    option.setAttribute('data-region', origin.region);
                    
                    // Create descriptive text
                    option.textContent = `${origin.name} (${origin.bucketName}.s3.amazonaws.com)`;
                    
                    select.appendChild(option);
                });
                
                // Add option for no origins available
                if (response.data.origins.length === 0) {
                    const noOriginOption = document.createElement('option');
                    noOriginOption.value = '';
                    noOriginOption.textContent = 'No origins available - create one first';
                    noOriginOption.disabled = true;
                    select.appendChild(noOriginOption);
                }
                
                return response.data.origins;
            } else {
                console.error('Failed to load origins:', response.error);
                select.classList.remove('loading');
                select.innerHTML = '<option value="">Failed to load origins</option>';
                return [];
            }
        })
        .catch(error => {
            console.error('Error loading origins:', error);
            select.classList.remove('loading');
            select.innerHTML = '<option value="">Error loading origins</option>';
            return [];
        });
}

// Setup distribution creation modal functionality
function setupDistributionModal() {
    const createDistributionBtn = document.querySelector('#distributions-page .btn-primary');
    const cancelDistributionBtn = document.getElementById('cancel-distribution-btn');
    const createDistributionModal = document.getElementById('create-distribution-modal');
    const createDistributionSubmitBtn = document.getElementById('create-distribution-submit-btn');
    const closeBtn = document.querySelector('#create-distribution-modal .close-btn');
    const useCustomOriginCheckbox = document.getElementById('use-custom-origin');
    const customOriginInput = document.getElementById('custom-origin-domain');
    const originSelect = document.getElementById('origin-domain');

    // Handle custom origin toggle
    if (useCustomOriginCheckbox && customOriginInput && originSelect) {
        useCustomOriginCheckbox.addEventListener('change', function() {
            if (this.checked) {
                originSelect.style.display = 'none';
                customOriginInput.style.display = 'block';
                customOriginInput.required = true;
                originSelect.required = false;
            } else {
                originSelect.style.display = 'block';
                customOriginInput.style.display = 'none';
                customOriginInput.required = false;
                originSelect.required = true;
            }
        });
    }

    if (createDistributionBtn) {
        createDistributionBtn.addEventListener('click', function() {
            createDistributionModal.classList.add('active');
            // Populate dropdowns when modal opens
            populateOriginDropdown('origin-domain');
            populateCertificateDropdown('dist-certificate-arn');
        });
    }

    if (cancelDistributionBtn) {
        cancelDistributionBtn.addEventListener('click', function() {
            createDistributionModal.classList.remove('active');
            resetDistributionForm();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            createDistributionModal.classList.remove('active');
            resetDistributionForm();
        });
    }

    // Handle distribution creation
    if (createDistributionSubmitBtn) {
        createDistributionSubmitBtn.addEventListener('click', function() {
            console.log('Create Distribution button clicked');
            
            const distributionData = createDistributionFromForm();
            if (!distributionData) {
                return; // Error already shown
            }
            
            console.log('Creating distribution with data:', distributionData);
            
            // Show loading state
            createDistributionSubmitBtn.disabled = true;
            createDistributionSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
            
            // Call API to create distribution
            apiCall('/distributions', 'POST', distributionData)
                .then(response => {
                    if (response.success) {
                        console.log('Distribution created successfully:', response.data);
                        alert('Distribution created successfully!');
                        
                        // Reset form and close modal
                        resetDistributionForm();
                        createDistributionModal.classList.remove('active');
                        
                        // Reload distributions list
                        loadApiData();
                    } else {
                        console.error('Failed to create distribution:', response.error);
                        alert(`Failed to create distribution: ${response.error}`);
                    }
                })
                .catch(error => {
                    console.error('Error creating distribution:', error);
                    alert('Failed to create distribution');
                })
                .finally(() => {
                    // Reset button state
                    createDistributionSubmitBtn.disabled = false;
                    createDistributionSubmitBtn.innerHTML = 'Create Distribution';
                });
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === createDistributionModal) {
            createDistributionModal.classList.remove('active');
            resetDistributionForm();
        }
    });
}

// Create distribution data from form
function createDistributionFromForm() {
    const name = document.getElementById('distribution-name')?.value?.trim();
    const useCustomOrigin = document.getElementById('use-custom-origin')?.checked;
    const originDomain = useCustomOrigin ? 
        document.getElementById('custom-origin-domain')?.value?.trim() :
        document.getElementById('origin-domain')?.value?.trim();
    const originPath = document.getElementById('origin-path')?.value?.trim() || '';
    const distributionType = document.getElementById('distribution-type')?.value || 'Web';
    const enableCompression = document.getElementById('enable-compression')?.checked || false;
    
    // SSL configuration
    const certificateArn = document.getElementById('dist-certificate-arn')?.value || '';
    const customDomains = document.getElementById('dist-custom-domains')?.value || '';
    const viewerProtocol = document.getElementById('dist-viewer-protocol')?.value || 'allow-all';
    const minTlsVersion = document.getElementById('dist-min-tls-version')?.value || 'TLSv1.2_2021';
    
    // Validation
    if (!name) {
        alert('Distribution name is required');
        return null;
    }
    
    if (!originDomain) {
        alert('Origin domain is required');
        return null;
    }
    
    // Generate a proper origin ID
    const originId = useCustomOrigin ? 
        'custom-origin-' + Date.now() : 
        'managed-origin-' + Date.now();
    
    console.log('Generated origin ID:', originId);
    
    // Get origin details if using managed origin
    let originConfig = {
        Id: originId,
        DomainName: originDomain,
        OriginPath: originPath.startsWith('/') ? originPath : (originPath ? '/' + originPath : '')
    };
    
    console.log('Initial origin config:', originConfig);
    
    if (!useCustomOrigin) {
        // Using managed S3 origin
        const originSelect = document.getElementById('origin-domain');
        const selectedOption = originSelect.options[originSelect.selectedIndex];
        
        // Only use the managed origin ID if it exists and is not null/empty
        const managedOriginId = selectedOption?.getAttribute('data-origin-id');
        console.log('Managed origin ID from dropdown:', managedOriginId);
        
        if (managedOriginId && managedOriginId !== 'null' && managedOriginId.trim() !== '') {
            console.log('Using managed origin ID:', managedOriginId);
            originConfig.Id = managedOriginId;
        } else {
            console.log('No valid managed origin ID, keeping generated ID:', originConfig.Id);
        }
        // Otherwise keep the generated originId
        
        originConfig.S3OriginConfig = {
            OriginAccessIdentity: ""
        };
    } else {
        // Using custom origin
        originConfig.CustomOriginConfig = {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: "https-only"
        };
    }
    
    console.log('Final origin config:', originConfig);
    
    // Build distribution configuration
    const distributionConfig = {
        Comment: `${name} - ${distributionType} Distribution`,
        Enabled: true,
        Origins: {
            Quantity: 1,
            Items: [originConfig]
        },
        DefaultCacheBehavior: {
            TargetOriginId: originConfig.Id, // ✅ Use the same ID as the origin
            ViewerProtocolPolicy: viewerProtocol,
            AllowedMethods: {
                Quantity: 2,
                Items: ["GET", "HEAD"],
                CachedMethods: {
                    Quantity: 2,
                    Items: ["GET", "HEAD"]
                }
            },
            CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
            Compress: enableCompression
        },
        PriceClass: "PriceClass_100"
    };
    
    // Add SSL configuration if provided
    if (certificateArn && customDomains && certificateArn !== '') {
        const domains = customDomains.split(',').map(d => d.trim()).filter(d => d);
        
        if (domains.length > 0) {
            distributionConfig.ViewerCertificate = {
                CloudFrontDefaultCertificate: false,  // Added: Required when using custom certificate
                AcmCertificateArn: certificateArn,
                Certificate: certificateArn,           // Added: Required Certificate field
                SSLSupportMethod: "sni-only",          // Fixed: Capital SSL
                MinimumProtocolVersion: minTlsVersion,
                CertificateSource: "acm"
            };
            
            distributionConfig.Aliases = {
                Quantity: domains.length,
                Items: domains
            };
        } else {
            // No custom domains, use default certificate
            distributionConfig.ViewerCertificate = {
                CloudFrontDefaultCertificate: true,
                MinimumProtocolVersion: minTlsVersion
            };
        }
    } else {
        distributionConfig.ViewerCertificate = {
            CloudFrontDefaultCertificate: true,
            MinimumProtocolVersion: minTlsVersion
        };
    }
    
    console.log('Generated distribution config:', distributionConfig);
    
    return {
        name: name,
        type: distributionType,
        config: distributionConfig,
        // Additional metadata
        certificateArn: certificateArn,
        customDomains: customDomains,
        viewerProtocol: viewerProtocol,
        minTlsVersion: minTlsVersion
    };
}

// Reset distribution form
function resetDistributionForm() {
    document.getElementById('distribution-name').value = '';
    document.getElementById('origin-domain').value = '';
    document.getElementById('custom-origin-domain').value = '';
    document.getElementById('origin-path').value = '';
    document.getElementById('distribution-type').value = 'Web';
    document.getElementById('enable-compression').checked = true;
    document.getElementById('use-custom-origin').checked = false;
    
    // Reset SSL fields
    document.getElementById('dist-certificate-arn').value = '';
    document.getElementById('dist-custom-domains').value = '';
    document.getElementById('dist-viewer-protocol').value = 'redirect-to-https';
    document.getElementById('dist-min-tls-version').value = 'TLSv1.2_2021';
    
    // Reset visibility
    document.getElementById('origin-domain').style.display = 'block';
    document.getElementById('custom-origin-domain').style.display = 'none';
    document.getElementById('origin-domain').required = true;
    document.getElementById('custom-origin-domain').required = false;
}

// Load certificates from API
function loadCertificates() {
    console.log('Loading certificates from API...');
    return apiCall('/certificates')
        .then(response => {
            console.log('Certificates API response:', response);
            if (response.success) {
                console.log('Loaded certificates:', response.data.certificates);
                return response.data.certificates || [];
            } else {
                console.error('Failed to load certificates:', response.error);
                // Check if it's a 404 (endpoint not deployed)
                if (response.error && response.error.includes('404')) {
                    console.warn('Certificates API endpoint not found - may not be deployed yet');
                }
                return [];
            }
        })
        .catch(error => {
            console.error('Error loading certificates:', error);
            // Check if it's a network error or 404
            if (error.message && error.message.includes('404')) {
                console.warn('Certificates API endpoint not found - deploy CfManagerBackendStack to enable certificate management');
            }
            return [];
        });
}

// Populate certificate dropdown
function populateCertificateDropdown(selectId = 'certificate-arn') {
    const select = document.getElementById(selectId);
    if (!select) {
        console.warn(`Certificate dropdown element not found: ${selectId}`);
        return Promise.resolve();
    }
    
    console.log(`Populating certificate dropdown: ${selectId}`);
    
    // Show loading state
    select.innerHTML = '<option value="">Loading certificates...</option>';
    select.disabled = true;
    
    return loadCertificates().then(certificates => {
        // Reset dropdown
        select.disabled = false;
        select.innerHTML = '<option value="">No SSL Certificate (CloudFront Default)</option>';
        
        console.log(`Found ${certificates.length} certificates for dropdown ${selectId}`);
        
        if (certificates.length === 0) {
            // Add informational options
            const noCertsOption = document.createElement('option');
            noCertsOption.value = '';
            noCertsOption.textContent = '--- No certificates available ---';
            noCertsOption.disabled = true;
            select.appendChild(noCertsOption);
            
            const helpOption = document.createElement('option');
            helpOption.value = '';
            helpOption.textContent = 'Create certificates in ACM (us-east-1 region)';
            helpOption.disabled = true;
            helpOption.style.fontStyle = 'italic';
            helpOption.style.color = '#666';
            select.appendChild(helpOption);
            
            const deployOption = document.createElement('option');
            deployOption.value = '';
            deployOption.textContent = 'Deploy CfManagerBackendStack if not done';
            deployOption.disabled = true;
            deployOption.style.fontStyle = 'italic';
            deployOption.style.color = '#666';
            select.appendChild(deployOption);
            
            return;
        }
        
        // Add certificate options
        certificates.forEach(cert => {
            const option = document.createElement('option');
            option.value = cert.arn;
            
            // Create descriptive text
            let domains = [cert.domainName];
            if (cert.subjectAlternativeNames && cert.subjectAlternativeNames.length > 0) {
                domains = domains.concat(cert.subjectAlternativeNames);
            }
            const uniqueDomains = [...new Set(domains)];
            
            option.textContent = `${uniqueDomains.join(', ')} (${cert.status || 'ISSUED'})`;
            
            // Add expiration warning if applicable
            if (cert.daysUntilExpiration && cert.daysUntilExpiration < 30) {
                option.textContent += ` ⚠️ Expires in ${cert.daysUntilExpiration} days`;
                option.style.color = 'orange';
            }
            
            select.appendChild(option);
            console.log(`Added certificate option: ${option.textContent}`);
        });
    }).catch(error => {
        console.error(`Error populating certificate dropdown ${selectId}:`, error);
        select.disabled = false;
        select.innerHTML = '<option value="">No SSL Certificate (CloudFront Default)</option>';
        
        // Add error information
        const errorOption = document.createElement('option');
        errorOption.value = '';
        errorOption.textContent = 'Error loading certificates - check console';
        errorOption.disabled = true;
        errorOption.style.color = 'red';
        select.appendChild(errorOption);
    });
}

// Setup certificate refresh buttons
function setupCertificateRefreshButtons() {
    // Template certificate refresh button
    const refreshTemplateCertsBtn = document.getElementById('refresh-template-certs');
    if (refreshTemplateCertsBtn) {
        refreshTemplateCertsBtn.addEventListener('click', function() {
            console.log('Refreshing template certificates...');
            this.classList.add('loading');
            populateCertificateDropdown('certificate-arn').finally(() => {
                this.classList.remove('loading');
            });
        });
    }
    
    // Distribution certificate refresh button
    const refreshDistCertsBtn = document.getElementById('refresh-dist-certs');
    if (refreshDistCertsBtn) {
        refreshDistCertsBtn.addEventListener('click', function() {
            console.log('Refreshing distribution certificates...');
            this.classList.add('loading');
            populateCertificateDropdown('dist-certificate-arn').finally(() => {
                this.classList.remove('loading');
            });
        });
    }
}

// Test certificates API (for debugging)
function testCertificatesAPI() {
    console.log('Testing certificates API...');
    
    // Test if we can reach the API
    fetch((window.API_URL || getApiUrl()) + '/certificates', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('idToken')}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('Raw certificates API response status:', response.status);
        console.log('Raw certificates API response headers:', response.headers);
        return response.text();
    })
    .then(text => {
        console.log('Raw certificates API response body:', text);
        try {
            const json = JSON.parse(text);
            console.log('Parsed certificates API response:', json);
        } catch (e) {
            console.error('Failed to parse certificates API response as JSON:', e);
        }
    })
    .catch(error => {
        console.error('Certificates API test failed:', error);
    });
}

// Test API health (for debugging)
function testAPIHealth() {
    console.log('Testing API health...');
    
    // Test a simple GET request first
    return fetch((window.API_URL || getApiUrl()) + '/distributions', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('idToken')}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        console.log('Health check response status:', response.status);
        console.log('Health check response headers:', [...response.headers.entries()]);
        return response.text();
    })
    .then(text => {
        console.log('Health check raw response:', text);
        try {
            const json = JSON.parse(text);
            console.log('Health check parsed response:', json);
            return json;
        } catch (e) {
            console.error('Health check - failed to parse JSON:', e);
            return { error: 'Invalid JSON', raw: text };
        }
    })
    .catch(error => {
        console.error('Health check failed:', error);
        return { error: error.message };
    });
}

// Test distribution creation API (for debugging)
function testDistributionAPI() {
    console.log('Testing distribution creation API...');
    
    const testData = {
        name: 'test-distribution',
        type: 'Web',
        config: {
            Comment: 'Test distribution',
            Enabled: true,
            Origins: {
                Quantity: 1,
                Items: [{
                    Id: 'test-origin',
                    DomainName: 'example.com',
                    OriginPath: '',
                    CustomOriginConfig: {
                        HTTPPort: 80,
                        HTTPSPort: 443,
                        OriginProtocolPolicy: 'https-only'
                    }
                }]
            },
            DefaultCacheBehavior: {
                TargetOriginId: 'test-origin',
                ViewerProtocolPolicy: 'allow-all',
                AllowedMethods: {
                    Quantity: 2,
                    Items: ['GET', 'HEAD'],
                    CachedMethods: {
                        Quantity: 2,
                        Items: ['GET', 'HEAD']
                    }
                },
                CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6'
            },
            PriceClass: 'PriceClass_100',
            ViewerCertificate: {
                CloudFrontDefaultCertificate: true,
                MinimumProtocolVersion: 'TLSv1.2_2021'
            }
        }
    };
    
    console.log('Test data:', testData);
    
    return apiCall('/distributions', 'POST', testData)
        .then(response => {
            console.log('Test API response:', response);
            return response;
        })
        .catch(error => {
            console.error('Test API error:', error);
            return error;
        });
}

// Enhanced template creation with SSL support
function createTemplateWithSSL() {
    const certificateArn = document.getElementById('certificate-arn')?.value || '';
    const customDomains = document.getElementById('custom-domains')?.value || '';
    const viewerProtocol = document.getElementById('viewer-protocol')?.value || 'allow-all';
    const minTlsVersion = document.getElementById('min-tls-version')?.value || 'TLSv1.2_2021';
    
    // Get other form values
    const name = document.getElementById('template-name')?.value || '';
    const description = document.getElementById('template-description')?.value || '';
    const category = document.getElementById('template-category')?.value || 'General';
    
    if (!name) {
        alert('Template name is required');
        return null;
    }
    
    // Basic template configuration
    const templateData = {
        name: name,
        description: description,
        category: category,
        certificateArn: certificateArn,
        customDomains: customDomains,
        viewerProtocol: viewerProtocol,
        minTlsVersion: minTlsVersion,
        features: [],
        config: {
            Comment: description || name,
            Enabled: true,
            Origins: {
                Quantity: 1,
                Items: [
                    {
                        Id: "default-origin",
                        DomainName: "example.com",
                        OriginPath: "",
                        CustomOriginConfig: {
                            HTTPPort: 80,
                            HTTPSPort: 443,
                            OriginProtocolPolicy: "https-only"
                        }
                    }
                ]
            },
            DefaultCacheBehavior: {
                TargetOriginId: "default-origin",
                ViewerProtocolPolicy: viewerProtocol,
                AllowedMethods: {
                    Quantity: 2,
                    Items: ["GET", "HEAD"],
                    CachedMethods: {
                        Quantity: 2,
                        Items: ["GET", "HEAD"]
                    }
                },
                CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6"
            },
            PriceClass: "PriceClass_100"
        }
    };
    
    // Add SSL-specific features
    if (certificateArn && customDomains) {
        templateData.features.push('Custom SSL Certificate', 'Custom Domain', 'HTTPS Redirect');
    } else {
        templateData.features.push('CloudFront Default Certificate');
    }
    
    return templateData;
}

// Display certificate information in distribution/template details
function displayCertificateInfo(config, sslConfig = null) {
    const viewerCert = config.ViewerCertificate;
    
    if (viewerCert && viewerCert.AcmCertificateArn) {
        const domains = config.Aliases?.Items || [];
        return `
            <div class="certificate-info ssl-enabled">
                <h4><i class="fas fa-lock text-success"></i> SSL Certificate</h4>
                <div class="cert-details">
                    <p><strong>Type:</strong> AWS Certificate Manager</p>
                    <p><strong>ARN:</strong> <code class="cert-arn">${viewerCert.AcmCertificateArn}</code></p>
                    <p><strong>TLS Version:</strong> ${viewerCert.MinimumProtocolVersion}</p>
                    <p><strong>Support Method:</strong> ${viewerCert.SslSupportMethod}</p>
                    <p><strong>Protocol Policy:</strong> ${config.DefaultCacheBehavior?.ViewerProtocolPolicy || 'Not specified'}</p>
                    ${domains.length ? 
                        `<p><strong>Custom Domains:</strong> ${domains.join(', ')}</p>` : 
                        '<p><strong>Domains:</strong> No custom domains configured</p>'
                    }
                </div>
            </div>
        `;
    } else {
        return `
            <div class="certificate-info ssl-default">
                <h4><i class="fas fa-lock-open text-warning"></i> SSL Certificate</h4>
                <div class="cert-details">
                    <p><strong>Type:</strong> CloudFront Default Certificate</p>
                    <p><strong>Domain:</strong> *.cloudfront.net only</p>
                    <p><strong>TLS Version:</strong> ${viewerCert?.MinimumProtocolVersion || 'Default'}</p>
                    <p class="warning text-warning">⚠️ Custom domains require ACM certificate</p>
                </div>
            </div>
        `;
    }
}

// Check certificate expiration
function checkCertificateExpiration(certificateArn) {
    if (!certificateArn) return Promise.resolve(null);
    
    return apiCall(`/certificates/${encodeURIComponent(certificateArn)}`)
        .then(response => {
            if (response.success) {
                const cert = response.data.certificate;
                return {
                    daysUntilExpiration: cert.daysUntilExpiration,
                    isExpiringSoon: cert.isExpiringSoon,
                    notAfter: cert.notAfter
                };
            }
            return null;
        })
        .catch(error => {
            console.error('Error checking certificate expiration:', error);
            return null;
        });
}

// Mock data - kept for fallback if API is not available
const mockData = {
    'distributions': [
        {
            id: 'dist-001',
            name: 'game-assets.example.com',
            domainName: 'd1a2b3c4.cloudfront.net',
            origin: 'assets-bucket.s3.amazonaws.com',
            status: 'Deployed',
            lastModified: '2025-06-24'
        },
        {
            id: 'dist-002',
            name: 'cdn.mygame.com',
            domainName: 'd5e6f7g8.cloudfront.net',
            origin: 'game-content.s3.amazonaws.com',
            status: 'Deployed',
            lastModified: '2025-06-23'
        },
        {
            id: 'dist-003',
            name: 'downloads.gamestudio.com',
            domainName: 'd9h0i1j2.cloudfront.net',
            origin: 'downloads-origin.s3.amazonaws.com',
            status: 'In Progress',
            lastModified: '2025-06-25'
        }
    ],
    'origins': [
        {
            id: 'origin-001',
            name: 'Game Assets Origin',
            bucketName: 'assets-bucket',
            region: 'us-east-1',
            isWebsiteEnabled: true,
            createdAt: '2025-06-24'
        },
        {
            id: 'origin-002',
            name: 'Game Content Origin',
            bucketName: 'game-content',
            region: 'us-west-2',
            isWebsiteEnabled: false,
            createdAt: '2025-06-23'
        },
        {
            id: 'origin-003',
            name: 'Downloads Origin',
            bucketName: 'downloads-origin',
            region: 'eu-west-1',
            isWebsiteEnabled: true,
            createdAt: '2025-06-25'
        }
    ],
    'templates': [
        {
            id: 'tmpl-001',
            name: 'Game Assets CDN',
            category: 'Web',
            description: 'Optimized for game assets with high TTL and compression.',
            features: ['Compression', 'WAF', 'Performance']
        },
        {
            id: 'tmpl-002',
            name: 'Game Downloads',
            category: 'Download',
            description: 'Configured for large file downloads with regional edge caches.',
            features: ['Large Files', 'Global', 'Security']
        },
        {
            id: 'tmpl-003',
            name: 'Game Streaming',
            category: 'Streaming',
            description: 'Optimized for video streaming with low latency.',
            features: ['Video', 'Low Latency', 'Secure']
        }
    ]
};

// Setup templates UI functionality
function setupTemplatesUI() {
    // Modal functionality for templates
    const createTemplateBtn = document.querySelector('#templates-page .btn-primary');
    const cancelTemplateBtn = document.getElementById('cancel-template-btn');
    const createTemplateModal = document.getElementById('create-template-modal');
    const createTemplateSubmitBtn = document.getElementById('create-template-submit-btn');
    const closeBtn = document.querySelector('#create-template-modal .close-btn');

    if (createTemplateBtn) {
        createTemplateBtn.addEventListener('click', function() {
            createTemplateModal.classList.add('active');
            // Refresh certificate dropdown when modal opens
            populateCertificateDropdown('certificate-arn');
        });
    }

    if (cancelTemplateBtn) {
        cancelTemplateBtn.addEventListener('click', function() {
            createTemplateModal.classList.remove('active');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            createTemplateModal.classList.remove('active');
        });
    }

    // Add event handler for the Create Template submit button
    if (createTemplateSubmitBtn) {
        createTemplateSubmitBtn.addEventListener('click', function() {
            console.log('Create Template button clicked');
            
            const templateData = createTemplateWithSSL();
            if (!templateData) {
                return; // Error already shown in createTemplateWithSSL
            }
            
            console.log('Creating template with data:', templateData);
            
            // Show loading state
            createTemplateSubmitBtn.disabled = true;
            createTemplateSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
            
            // Call API to create template
            apiCall('/templates', 'POST', templateData)
                .then(response => {
                    if (response.success) {
                        console.log('Template created successfully:', response.data);
                        alert('Template created successfully!');
                        
                        // Reset form
                        document.getElementById('template-name').value = '';
                        document.getElementById('template-description').value = '';
                        document.getElementById('template-category').value = 'Web';
                        document.getElementById('certificate-arn').value = '';
                        document.getElementById('custom-domains').value = '';
                        document.getElementById('viewer-protocol').value = 'redirect-to-https';
                        document.getElementById('min-tls-version').value = 'TLSv1.2_2021';
                        
                        // Close modal
                        createTemplateModal.classList.remove('active');
                        
                        // Reload templates list
                        loadApiData();
                    } else {
                        console.error('Failed to create template:', response.error);
                        alert(`Failed to create template: ${response.error}`);
                    }
                })
                .catch(error => {
                    console.error('Error creating template:', error);
                    alert('Failed to create template');
                })
                .finally(() => {
                    // Reset button state
                    createTemplateSubmitBtn.disabled = false;
                    createTemplateSubmitBtn.innerHTML = 'Create Template';
                });
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === createTemplateModal) {
            createTemplateModal.classList.remove('active');
        }
    });
}
