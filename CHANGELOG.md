# Changelog

## [Latest] - 2025-07-29

### Added
- **Role-Based Access Control System**
  - Cognito user groups integration for admin/user roles
  - Dynamic menu visibility based on user permissions
  - Admin-only access to Origins and Settings pages
  - User role display in header (Admin/User)
  - Enhanced API Gateway authorizer with group validation

- **Settings Management**
  - CloudFront Standard v2 access logs configuration
  - Consolidated access logs with S3 bucket management
  - Admin-only settings interface
  - Real-time configuration updates

- **Enhanced Security for S3 Origins**
  - Removed website hosting option from origin creation
  - Removed CORS configuration from origin creation
  - Default to secure private buckets with OAC only
  - Follows AWS security best practices

- **CSS Troubleshooting Documentation**
  - Comprehensive CSS_TROUBLESHOOTING.md guide
  - Documents CSS specificity conflict resolution
  - Debugging techniques and prevention strategies

### Changed
- **Frontend Architecture**
  - Added `role-based.css` for role-specific styling
  - Added `group-utils.js` for Cognito user group management
  - Updated navigation system with role-based menu visibility
  - Simplified origin creation form (removed website hosting/CORS)

- **Backend Infrastructure**
  - Added settings management stack (`cf-manager-settings-stack.ts`)
  - Enhanced authorizer with user group validation
  - Updated origins creation to disable website hosting by default

- **UI/UX Improvements**
  - Hidden Templates menu (not currently used)
  - Hidden unimplemented Settings sections
  - Cleaner, more focused origin creation interface
  - Fixed page navigation CSS specificity issues

### Fixed
- **Navigation Issues**
  - Resolved CSS specificity conflict causing multiple pages to display
  - Fixed Create Origin button not working after UI changes
  - Removed references to deleted HTML elements in JavaScript

- **Security Improvements**
  - Origins now created with secure defaults (private buckets, OAC)
  - Removed potential security risks from website hosting option
  - Enhanced backend authorization validation

### Technical Details
- **New Files Added:**
  - `frontend-simple/css/role-based.css`
  - `frontend-simple/js/group-utils.js`
  - `functions-python/settings/`
  - `lib/cf-manager-settings-stack.ts`
  - `CSS_TROUBLESHOOTING.md`

- **Modified Files:**
  - `frontend-simple/index.html` - Role-based attributes, hidden admin menus
  - `frontend-simple/js/main.js` - Removed website hosting/CORS, fixed navigation
  - `frontend-simple/css/styles.css` - Enhanced page navigation CSS
  - `lib/cf-manager-backend-stack.ts` - Backend infrastructure updates
  - `README.md` - Updated documentation for role-based access control

### Migration Notes
- **For Administrators**: Add users to "Administrators" Cognito group to access Origins and Settings
- **For Origins**: Existing origins with website hosting will continue to work, but new origins will be created securely by default
- **For UI**: Templates menu is hidden but functionality remains in codebase for future use

### Breaking Changes
- Origins creation no longer supports website hosting or CORS configuration through UI
- Admin-only menus (Origins, Settings) are hidden for regular users
- Templates functionality is hidden from UI (but remains in backend)
