// Authentication configuration
const authConfig = {
    UserPoolId: '', // Will be populated from environment
    ClientId: '',   // Will be populated from environment
    Region: ''      // Will be populated from environment
};

// DOM Elements
const loginButton = document.getElementById('login-button');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const forgotPasswordModal = document.getElementById('forgot-password-modal');
const closeBtn = document.querySelector('.close-btn');
const cancelResetBtn = document.getElementById('cancel-reset-btn');
const requestCodeBtn = document.getElementById('request-code-btn');
const resetPasswordBtn = document.getElementById('reset-password-btn');
const resetUsername = document.getElementById('reset-username');
const verificationSection = document.getElementById('verification-section');
const verificationCode = document.getElementById('verification-code');
const newPassword = document.getElementById('new-password');
const forgotError = document.getElementById('forgot-error');

// Global variables for new password challenge
let cognitoUserGlobal;
let userAttributesGlobal;
let requiredAttributesGlobal;

// Initialize authentication
async function initAuth() {
    try {
        // Fetch configuration from environment file
        const response = await fetch('/js/env.js');
        if (!response.ok) {
            throw new Error('Failed to load environment configuration');
        }
        
        const envText = await response.text();
        // Execute the env.js content to set window.ENV
        eval(envText);
        
        if (window.ENV) {
            authConfig.UserPoolId = window.ENV.USER_POOL_ID;
            authConfig.ClientId = window.ENV.USER_POOL_CLIENT_ID;
            authConfig.Region = window.ENV.REGION;
            
            // Check if we have a session
            checkSession();
        } else {
            showError(loginError, 'Environment configuration not found');
        }
    } catch (error) {
        console.error('Error initializing auth:', error);
        showError(loginError, 'Failed to initialize authentication');
    }
}

// Check if user is already logged in
function checkSession() {
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: authConfig.UserPoolId,
        ClientId: authConfig.ClientId
    });
    
    const cognitoUser = userPool.getCurrentUser();
    
    if (cognitoUser != null) {
        cognitoUser.getSession((err, session) => {
            if (err) {
                console.error('Error getting session:', err);
                return;
            }
            
            if (session.isValid()) {
                // Redirect to main application
                window.location.href = 'index.html';
            }
        });
    }
}

// Handle login
function handleLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
        showError(loginError, 'Please enter both username and password');
        return;
    }
    
    // Clear previous errors
    hideError(loginError);
    
    // Show loading state
    loginButton.disabled = true;
    loginButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    
    const authenticationData = {
        Username: username,
        Password: password
    };
    
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);
    
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: authConfig.UserPoolId,
        ClientId: authConfig.ClientId
    });
    
    const userData = {
        Username: username,
        Pool: userPool
    };
    
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    
    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function(result) {
            // Store tokens
            const idToken = result.getIdToken().getJwtToken();
            const accessToken = result.getAccessToken().getJwtToken();
            const refreshToken = result.getRefreshToken().getToken();
            
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            
            // Redirect to main application
            window.location.href = 'index.html';
        },
        onFailure: function(err) {
            console.error('Authentication failed:', err);
            loginButton.disabled = false;
            loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
            
            if (err.code === 'UserNotConfirmedException') {
                showError(loginError, 'Account not verified. Please check your email for verification code.');
            } else if (err.code === 'NotAuthorizedException') {
                showError(loginError, 'Incorrect username or password');
            } else {
                showError(loginError, err.message || 'Failed to sign in');
            }
        },
        newPasswordRequired: function(userAttributes, requiredAttributes) {
            // Store user data for the new password challenge
            cognitoUserGlobal = cognitoUser;
            userAttributesGlobal = userAttributes;
            requiredAttributesGlobal = requiredAttributes;
            
            // Reset login button
            loginButton.disabled = false;
            loginButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
            
            // Show new password modal
            showNewPasswordModal();
        }
    });
}

// Show new password modal
function showNewPasswordModal() {
    // Create modal if it doesn't exist
    if (!document.getElementById('new-password-modal')) {
        const modalHTML = `
        <div class="modal active" id="new-password-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Change Password Required</h2>
                </div>
                <div class="modal-body">
                    <p>You need to change your password before continuing.</p>
                    <div id="new-password-error" class="error-message"></div>
                    <div class="form-group">
                        <label for="new-password-input">New Password</label>
                        <input type="password" id="new-password-input" placeholder="Enter new password">
                    </div>
                    <div class="form-group">
                        <label for="confirm-password-input">Confirm Password</label>
                        <input type="password" id="confirm-password-input" placeholder="Confirm new password">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" id="submit-new-password-btn">Change Password</button>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add event listener to the submit button
        document.getElementById('submit-new-password-btn').addEventListener('click', submitNewPassword);
    } else {
        // Show the modal if it already exists
        document.getElementById('new-password-modal').classList.add('active');
    }
}

// Submit new password
function submitNewPassword() {
    const newPasswordInput = document.getElementById('new-password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const newPasswordError = document.getElementById('new-password-error');
    const submitBtn = document.getElementById('submit-new-password-btn');
    
    const newPwd = newPasswordInput.value;
    const confirmPwd = confirmPasswordInput.value;
    
    // Validate passwords
    if (!newPwd) {
        showError(newPasswordError, 'Please enter a new password');
        return;
    }
    
    if (newPwd !== confirmPwd) {
        showError(newPasswordError, 'Passwords do not match');
        return;
    }
    
    // Password complexity check
    if (newPwd.length < 8) {
        showError(newPasswordError, 'Password must be at least 8 characters long');
        return;
    }
    
    if (!/[A-Z]/.test(newPwd)) {
        showError(newPasswordError, 'Password must contain at least one uppercase letter');
        return;
    }
    
    if (!/[a-z]/.test(newPwd)) {
        showError(newPasswordError, 'Password must contain at least one lowercase letter');
        return;
    }
    
    if (!/[0-9]/.test(newPwd)) {
        showError(newPasswordError, 'Password must contain at least one number');
        return;
    }
    
    if (!/[^A-Za-z0-9]/.test(newPwd)) {
        showError(newPasswordError, 'Password must contain at least one special character');
        return;
    }
    
    hideError(newPasswordError);
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Changing Password...';
    
    // Complete the new password challenge
    cognitoUserGlobal.completeNewPasswordChallenge(newPwd, userAttributesGlobal, {
        onSuccess: function(result) {
            // Store tokens
            const idToken = result.getIdToken().getJwtToken();
            const accessToken = result.getAccessToken().getJwtToken();
            const refreshToken = result.getRefreshToken().getToken();
            
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            
            // Hide modal
            document.getElementById('new-password-modal').classList.remove('active');
            
            // Show success message
            alert('Password changed successfully! You will now be redirected to the application.');
            
            // Redirect to main application
            window.location.href = 'index.html';
        },
        onFailure: function(err) {
            console.error('Password change failed:', err);
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Change Password';
            
            showError(newPasswordError, err.message || 'Failed to change password');
        }
    });
}

// Handle forgot password
function handleForgotPassword() {
    forgotPasswordModal.classList.add('active');
}

// Request password reset code
function requestCode() {
    const username = resetUsername.value.trim();
    
    if (!username) {
        showError(forgotError, 'Please enter your username');
        return;
    }
    
    hideError(forgotError);
    requestCodeBtn.disabled = true;
    requestCodeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: authConfig.UserPoolId,
        ClientId: authConfig.ClientId
    });
    
    const userData = {
        Username: username,
        Pool: userPool
    };
    
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    
    cognitoUser.forgotPassword({
        onSuccess: function() {
            requestCodeBtn.disabled = false;
            requestCodeBtn.innerHTML = 'Request Code';
            requestCodeBtn.style.display = 'none';
            resetPasswordBtn.style.display = 'block';
            verificationSection.style.display = 'block';
        },
        onFailure: function(err) {
            console.error('Forgot password request failed:', err);
            requestCodeBtn.disabled = false;
            requestCodeBtn.innerHTML = 'Request Code';
            showError(forgotError, err.message || 'Failed to request password reset');
        }
    });
}

// Reset password with verification code
function resetPassword() {
    const username = resetUsername.value.trim();
    const code = verificationCode.value.trim();
    const newPwd = newPassword.value;
    
    if (!username || !code || !newPwd) {
        showError(forgotError, 'Please fill in all fields');
        return;
    }
    
    hideError(forgotError);
    resetPasswordBtn.disabled = true;
    resetPasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
    
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId: authConfig.UserPoolId,
        ClientId: authConfig.ClientId
    });
    
    const userData = {
        Username: username,
        Pool: userPool
    };
    
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    
    cognitoUser.confirmPassword(code, newPwd, {
        onSuccess: function() {
            resetPasswordBtn.disabled = false;
            resetPasswordBtn.innerHTML = 'Reset Password';
            alert('Password reset successful. You can now login with your new password.');
            forgotPasswordModal.classList.remove('active');
            resetForm();
        },
        onFailure: function(err) {
            console.error('Password reset failed:', err);
            resetPasswordBtn.disabled = false;
            resetPasswordBtn.innerHTML = 'Reset Password';
            showError(forgotError, err.message || 'Failed to reset password');
        }
    });
}

// Reset the forgot password form
function resetForm() {
    resetUsername.value = '';
    verificationCode.value = '';
    newPassword.value = '';
    verificationSection.style.display = 'none';
    requestCodeBtn.style.display = 'block';
    resetPasswordBtn.style.display = 'none';
    hideError(forgotError);
}

// Show error message
function showError(element, message) {
    element.textContent = message;
    element.classList.add('active');
}

// Hide error message
function hideError(element) {
    element.textContent = '';
    element.classList.remove('active');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize authentication
    initAuth();
    
    // Login button click
    if (loginButton) {
        loginButton.addEventListener('click', handleLogin);
    }
    
    // Enter key in password field
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
    
    // Forgot password link
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            handleForgotPassword();
        });
    }
    
    // Close modal button
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            forgotPasswordModal.classList.remove('active');
            resetForm();
        });
    }
    
    // Cancel reset button
    if (cancelResetBtn) {
        cancelResetBtn.addEventListener('click', function() {
            forgotPasswordModal.classList.remove('active');
            resetForm();
        });
    }
    
    // Request code button
    if (requestCodeBtn) {
        requestCodeBtn.addEventListener('click', requestCode);
    }
    
    // Reset password button
    if (resetPasswordBtn) {
        resetPasswordBtn.addEventListener('click', resetPassword);
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        if (event.target === forgotPasswordModal) {
            forgotPasswordModal.classList.remove('active');
            resetForm();
        }
    });
});
