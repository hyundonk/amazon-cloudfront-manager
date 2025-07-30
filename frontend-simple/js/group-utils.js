/**
 * Group Management Utilities for CloudFront Manager
 * Implements simplified two-tier access control: Administrators and Regular Users
 */

class GroupManager {
    constructor() {
        this.userGroups = [];
        this.permissions = {};
        this.initialized = false;
    }
    
    /**
     * Extract user groups from Cognito JWT token
     */
    extractGroupsFromToken(idToken) {
        try {
            // Decode JWT token (without verification - server validates)
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            
            // Extract groups from cognito:groups claim
            this.userGroups = payload['cognito:groups'] || [];
            
            console.log('User groups extracted:', this.userGroups);
            return this.userGroups;
        } catch (error) {
            console.error('Error extracting groups from token:', error);
            this.userGroups = [];
            return [];
        }
    }
    
    /**
     * Check if user is in specific group
     */
    isInGroup(groupName) {
        return this.userGroups.includes(groupName);
    }
    
    /**
     * Check if user is admin (simplified two-tier model)
     */
    isAdmin() {
        return this.isInGroup('Administrators');
    }
    
    /**
     * Check if user is read-only (deprecated - keeping for backward compatibility)
     */
    isReadOnly() {
        return false; // Simplified model: only admin and regular users
    }
    
    /**
     * Get user's primary role (simplified two-tier model)
     */
    getPrimaryRole() {
        if (this.isAdmin()) return 'admin';
        return 'user'; // Simplified: only admin and regular user roles
    }
    
    /**
     * Check if user has permission for specific feature
     */
    hasPermission(feature) {
        const rolePermissions = {
            admin: [
                'settings', 
                'distributions', 
                'origins', 
                'origins:read',
                'origins:write',
                'certificates',
                'certificates:read',
                'certificates:write'
            ],
            user: [
                'distributions',
                'origins:read',      // Regular users can read origins but not modify them
                'certificates:read'  // Regular users can read certificates but not modify them
            ]
        };
        
        const userRole = this.getPrimaryRole();
        const permissions = rolePermissions[userRole] || [];
        
        // Check for exact match first
        if (permissions.includes(feature)) {
            return true;
        }
        
        // For backward compatibility, if user has 'origins' permission, 
        // they have both read and write access
        if (feature.startsWith('origins:') && permissions.includes('origins')) {
            return true;
        }
        
        // For backward compatibility, if user has 'certificates' permission,
        // they have both read and write access
        if (feature.startsWith('certificates:') && permissions.includes('certificates')) {
            return true;
        }
        
        return false;
    }
    
    /**
     * Check if user has permission for specific endpoint
     */
    hasEndpointPermission(endpoint, method = 'GET') {
        // Special handling for origins - users can read but not write
        if (endpoint.startsWith('/origins') || endpoint.includes('origins')) {
            if (method === 'GET') {
                // All authenticated users can read origins (needed for distribution creation)
                return true;
            } else {
                // Only admins can create/update/delete origins
                return this.isAdmin();
            }
        }
        
        // Special handling for certificates - users can read but not write
        if (endpoint.startsWith('/certificates') || endpoint.includes('certificates')) {
            if (method === 'GET') {
                // All authenticated users can read certificates (needed for distribution creation)
                return true;
            } else {
                // Only admins can create/update/delete certificates
                return this.isAdmin();
            }
        }
        
        // Admin-only endpoints: Settings
        const adminOnlyEndpoints = ['/settings'];
        
        if (adminOnlyEndpoints.some(adminEndpoint => 
            endpoint.startsWith(adminEndpoint) || endpoint.includes(adminEndpoint.substring(1)))) {
            return this.isAdmin();
        }
        
        // Distributions endpoints - accessible to all authenticated users
        if (endpoint.startsWith('/distributions') || endpoint.includes('distributions')) {
            return true; // All authenticated users can access distributions
        }
        
        // Default: allow access (for backward compatibility)
        return true;
    }
    
    /**
     * Initialize group manager with current session
     */
    async initialize() {
        try {
            const idToken = localStorage.getItem('idToken');
            if (idToken) {
                this.extractGroupsFromToken(idToken);
                this.initialized = true;
                
                // Wait for DOM to be ready before updating UI
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        this.updateUIBasedOnGroups();
                    });
                } else {
                    this.updateUIBasedOnGroups();
                }
            }
        } catch (error) {
            console.error('Failed to initialize group manager:', error);
        }
    }
    
    /**
     * Check if group manager is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    
    /**
     * Update UI elements based on user groups
     */
    updateUIBasedOnGroups() {
        console.log('Updating UI based on user groups:', this.userGroups);
        
        // Hide/show admin-only menus
        this.toggleAdminOnlyMenus();
        
        // Update user role indicator
        this.updateRoleIndicator();
        
        // Apply feature-specific permissions
        this.applyFeaturePermissions();
    }
    
    /**
     * Toggle admin-only menu visibility (Settings, Origins)
     */
    toggleAdminOnlyMenus() {
        const adminOnlyFeatures = ['settings', 'origins'];
        
        adminOnlyFeatures.forEach(feature => {
            const menuItem = document.querySelector(`[data-feature="${feature}"]`);
            const tabElement = document.querySelector(`#${feature}-tab`);
            const contentElement = document.querySelector(`#${feature}-content`);
            
            if (this.isAdmin()) {
                // Show admin-only features for admin users
                if (menuItem) {
                    menuItem.style.display = 'block';
                    console.log(`Showing ${feature} menu for admin user`);
                }
                if (tabElement) tabElement.style.display = 'block';
                if (contentElement) contentElement.style.display = 'block';
            } else {
                // Hide admin-only features for regular users
                if (menuItem) {
                    menuItem.style.display = 'none';
                    console.log(`Hiding ${feature} menu for regular user`);
                }
                if (tabElement) tabElement.style.display = 'none';
                if (contentElement) contentElement.style.display = 'none';
            }
        });
        
        // Always show distributions for all users
        const distributionsMenu = document.querySelector('[data-feature="distributions"]');
        const distributionsTab = document.querySelector('#distributions-tab');
        const distributionsContent = document.querySelector('#distributions-content');
        
        if (distributionsMenu) distributionsMenu.style.display = 'block';
        if (distributionsTab) distributionsTab.style.display = 'block';
        if (distributionsContent) distributionsContent.style.display = 'block';
        
        console.log('Distributions menu always visible for all users');
    }
    
    /**
     * Update role indicator in UI
     */
    updateRoleIndicator() {
        const roleIndicator = document.querySelector('.user-role');
        if (roleIndicator) {
            const role = this.getPrimaryRole();
            roleIndicator.textContent = `(${role.charAt(0).toUpperCase() + role.slice(1)})`;
            roleIndicator.className = `user-role role-${role}`;
            console.log(`Updated role indicator to: ${role}`);
        }
    }
    
    /**
     * Apply feature-specific permissions
     */
    applyFeaturePermissions() {
        // For regular users, add restricted access messages to admin-only sections
        if (!this.isAdmin()) {
            this.addRestrictedAccessMessage();
        }
    }
    
    /**
     * Add restricted access message for non-admin users
     */
    addRestrictedAccessMessage() {
        const restrictedFeatures = ['origins', 'settings'];
        
        restrictedFeatures.forEach(feature => {
            const contentElement = document.querySelector(`#${feature}-content`);
            if (contentElement && !contentElement.querySelector('.restricted-access-message')) {
                const message = document.createElement('div');
                message.className = 'restricted-access-message';
                message.innerHTML = `
                    <div class="restriction-banner">
                        <i class="fas fa-lock"></i>
                        <h3>Administrator Access Required</h3>
                        <p>You need administrator privileges to access ${feature.charAt(0).toUpperCase() + feature.slice(1)} management.</p>
                        <p>Contact your system administrator for access.</p>
                    </div>
                `;
                contentElement.insertBefore(message, contentElement.firstChild);
            }
        });
    }
    
    /**
     * Log access attempts for audit purposes
     */
    logAccess(feature, action, allowed) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId: this.getUserId(),
            userGroups: this.userGroups,
            feature: feature,
            action: action,
            allowed: allowed,
            userAgent: navigator.userAgent
        };
        
        console.log('Access log:', logEntry);
        
        // In production, send to audit service
        // this.sendAuditLog(logEntry);
    }
    
    /**
     * Get current user ID from token
     */
    getUserId() {
        try {
            const idToken = localStorage.getItem('idToken');
            if (idToken) {
                const payload = JSON.parse(atob(idToken.split('.')[1]));
                return payload.sub || payload.email || 'unknown';
            }
        } catch (error) {
            console.error('Error getting user ID:', error);
        }
        return 'unknown';
    }
}

/**
 * Permission checking utilities
 */

/**
 * Check if user has permission for specific endpoint
 */
function hasEndpointPermission(endpoint, method = 'GET') {
    if (!window.groupManager || !window.groupManager.isInitialized()) {
        console.warn('Group manager not initialized, allowing access');
        return true;
    }
    
    return window.groupManager.hasEndpointPermission(endpoint, method);
}

/**
 * Show permission error to user
 */
function showPermissionError(message) {
    // Create and show error modal
    const errorModal = document.createElement('div');
    errorModal.className = 'permission-error-modal';
    errorModal.innerHTML = `
        <div class="modal-overlay">
            <div class="modal-content error">
                <div class="error-icon">🚫</div>
                <h3>Access Denied</h3>
                <p>${message}</p>
                <button onclick="this.closest('.permission-error-modal').remove()">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(errorModal);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (errorModal.parentNode) {
            errorModal.remove();
        }
    }, 5000);
}

/**
 * Update navigation menu based on user permissions
 */
function updateNavigationMenu() {
    if (!window.groupManager || !window.groupManager.isInitialized()) {
        console.warn('Group manager not initialized, skipping menu update');
        return;
    }
    
    const isAdmin = window.groupManager.isAdmin();
    
    // Get menu items
    const settingsMenuItem = document.querySelector('[data-feature="settings"]');
    const originsMenuItem = document.querySelector('[data-feature="origins"]');
    const distributionsMenuItem = document.querySelector('[data-feature="distributions"]');
    
    if (isAdmin) {
        // Admin users see all menus (except templates which is disabled)
        if (settingsMenuItem) settingsMenuItem.style.display = 'block';
        if (originsMenuItem) originsMenuItem.style.display = 'block';
        if (distributionsMenuItem) distributionsMenuItem.style.display = 'block';
        console.log('Admin user: showing all menus');
    } else {
        // Regular users only see Distributions menu
        if (settingsMenuItem) settingsMenuItem.style.display = 'none';
        if (originsMenuItem) originsMenuItem.style.display = 'none';
        if (distributionsMenuItem) distributionsMenuItem.style.display = 'block';
        console.log('Regular user: showing only distributions menu');
    }
}

// Global instance
window.groupManager = new GroupManager();

// Initialize menu visibility on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing group-based menu visibility');
    
    // Wait for authentication to complete
    setTimeout(() => {
        if (window.groupManager && window.groupManager.isInitialized()) {
            updateNavigationMenu();
        } else {
            console.log('Group manager not ready, will retry...');
            // Retry after another second
            setTimeout(() => {
                if (window.groupManager && window.groupManager.isInitialized()) {
                    updateNavigationMenu();
                }
            }, 1000);
        }
    }, 1000);
});
