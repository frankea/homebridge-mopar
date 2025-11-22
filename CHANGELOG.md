# Change Log

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.9.14-beta.0 (2025-10-20)

### Added
- **Configuration Validator** - Comprehensive config validation with helpful error messages
  - Email format validation
  - Password length validation (min 8 characters)
  - PIN format validation (exactly 4 digits)
  - Shows all validation errors at once with numbered list
  - Prevents initialization with invalid config
- **Real-Time Vehicle Status** - Full implementation with VHR endpoint support
  - Door status for all 5 doors (front left/right, rear left/right, trunk)
  - Battery level monitoring
  - Lock status updates
  - Engine running status
  - Odometer reading
  - Fuel level tracking (when available)
  - Automatic fallback to vehicle list when VHR unavailable
- **Rate Limiting & API Protection** - Prevents account blocks from excessive API use
  - Start/Stop engine: 3 per hour (protects battery)
  - Lock/Unlock: 10 per 5 minutes
  - Horn & Lights: 5 per 5 minutes (prevents neighbor complaints)
  - Climate: 5 per 10 minutes
  - Per-vehicle tracking allows multiple vehicles
  - User-friendly warnings with wait times when limits exceeded
- **Structured Logging System** - Consistent logging across all classes
  - Support for error, warn, info, log, debug, and trace levels
  - Smart detection of Homebridge logger vs simple function
  - Proper method binding for error/warn methods
  - Backward compatible with existing code
- **Local-Only Metrics** - Debugging statistics (Homebridge verified compatible)
  - **NO external calls, NO tracking, NO data transmission**
  - Command success/failure rates and average durations
  - API call statistics
  - Error occurrence tracking
  - Login and session refresh statistics
  - Plugin uptime tracking
  - All data stays on user's machine

### Improved
- **Better Error Handling** - User-friendly error messages throughout codebase
  - Network errors: "Cannot reach Mopar.com - Check your internet connection"
  - Timeout errors: "Login timed out - Mopar.com may be slow or unreachable"
  - SSL errors: "Check your system time and date settings"
  - HTTP 401/403/429/500 errors with specific guidance
  - Initialization errors with clear banners and actionable steps
  - All errors include debug stack traces when debug mode enabled

### Fixed
- CHANGELOG format updated for Homebridge UI compatibility
  - Changed from `[X.Y.Z] - DATE` to `X.Y.Z (DATE)` format
  - Homebridge UI can now properly parse and display changelog
- .npmignore updated to exclude .cursorrules/ directory

### Technical
- Added 99 new tests (127 → 226 total tests)
- New test files: config-validator.test.js, rate-limiter.test.js, logger.test.js, metrics.test.js
- Enhanced api.test.js with vehicle status tests
- All 226 tests passing

## 0.9.13 (2025-10-20)

### Fixed
- **GitHub Actions workflow permissions** - Added `contents: write` permission to allow automated GitHub release creation

### Improved
- Releases now properly marked as beta/prerelease in GitHub
- Release titles include "(Beta)" designation

## 0.9.12 (2025-10-20)

### Fixed
- **CRITICAL:** Fixed crash in API error handling - `this.log.error is not a function`
  - API class was calling `this.log.error()` but only had `this.log()` available
  - Changed to `this.log('ERROR: ...')` for consistency with rest of codebase
  - Users will now see proper error messages instead of crashes
  - Affects initialization failures and profile API errors

### Improved
- Better error visibility when profile API returns 403 Unauthorized Access

## 0.9.10 (2025-10-20)

### Fixed
- **Session refresh reliability improvements**
  - Fixed 403 "Unauthorized Access" errors during scheduled session refresh
  - Added 2-second delay after setting cookies to allow Mopar backend session to propagate
  - Fixed silent failure in `getProfile()` - now properly detects and throws errors on failed responses
  - Profile endpoint now correctly validates error responses (status: "failed", errorCode: "403")
  - Improved error handling in `initialize()` - errors are now properly logged and re-thrown

### Technical Details
- Session refresh was setting cookies and immediately calling APIs before backend was ready
- CSRF token endpoint was succeeding but profile endpoint was rejecting with 403
- Added same 2-second propagation delay that initial Puppeteer login uses
- Now both 50-minute session refresh and 20-hour cookie refresh wait for backend

## 0.9.9 (2025-10-20)

### Improved
- **Proactive session refresh** every 50 minutes
  - Prevents HTTP 500 errors from expired session cookies
  - Sessions expire after ~1 hour, so refresh at 50 minutes
  - Commands now **always succeed immediately** (never wait for re-auth)
  - Background Puppeteer login runs automatically
  - Two refresh timers: 50 minutes (session) + 20 hours (cookies)

## 0.9.8 (2025-10-20)

### Fixed
- **CRITICAL:** Commands failing with HTTP 500 after ~1 hour
  - Session cookies (JSESSIONID, etc.) expire after 1 hour
  - CSRF token refresh was not enough - need full re-authentication
  - Plugin now does fresh login on 500 errors (like 403/401 handling)
  - Commands automatically succeed on retry with fresh session
  - User experience: commands "just work" even with expired sessions

## 0.9.7 (2025-10-20)

### Improved
- Enhanced error logging for API failures (500, 400, 403 errors)
  - Now logs HTTP status code, URL, and response body
  - Helps diagnose Mopar API issues (500 errors, rate limiting, etc.)
  - Request body logged in debug mode for troubleshooting 400 errors

## 0.9.4 (2025-10-17)

### Fixed
- Missing success/failure logging for engine start/stop, horn, and climate commands
- Users can now see if commands actually worked
- Matches lock/unlock behavior which already had proper logging

## 0.9.3 (2025-10-17)

### Fixed
- **CRITICAL:** Commands failing after 16+ hours with 403/401/400 errors
  - Sessions can expire before 20-hour cookie refresh
  - Commands now automatically re-authenticate on session expiry
  - Retry once with fresh session
  - Users never notice - commands just work

## 0.9.2 (2025-10-16)

### Fixed
- Removed ConfiguredName warnings from Homebridge logs (7 warnings eliminated)
- Services still display with correct names, just cleaner logs

## 0.9.1 (2025-10-16)

### Added
- ESLint + Prettier for code quality
- Jest test suite (13 tests)
- Enhanced config UI with organized fieldsets
- Header and footer in config schema

### Changed
- Better npm keywords for discoverability

### Added
- Configurable debug logging (off by default for clean logs)
- Debug checkbox in plugin settings UI
- Verbose logging only when troubleshooting

### Fixed
- **CRITICAL:** Door sensors were not being configured (code existed but never called)
- **CRITICAL:** Background refresh used stale cookies and ran indefinitely (4+ hours!)
  - Now performs fresh Puppeteer login each attempt
  - Added 1-hour retry limit (12 attempts max)
  - Stops gracefully instead of running forever
- Cold start empty vehicle list issue by adding missing profile initialization call
- Background refresh now properly initializes backend session
- Vehicles now load successfully on first attempt (no more retries needed)

### Changed
- Branding from "Chrysler Uconnect" to "Mopar" in user-facing text
- Default platform name now "Mopar" (reflects multi-brand support)
- Log messages use "Mopar" prefix for consistency
- Platform alias remains "ChryslerUconnect" for technical compatibility

### Optimized
- Login flow ~35-50 seconds faster (60% improvement!)
  - Browser cleanup now async (saves 20-40 seconds!)
  - Reduced form submit wait: 1.5s → 500ms
  - Reduced POST navigation timeout: 15s → 3s  
  - Skipped failed regular click attempt
- Much cleaner logs by moving verbose details to debug mode
- Only essential information shown unless debug enabled
- **Total login time: ~30-45 seconds (was ~60-90 seconds)**

### Security
- Added HAR files to .gitignore and .npmignore
- Excluded test configs with potential personal data from npm package
- Excluded development files (.claude, BETA_RELEASE_SUMMARY, etc) from npm
- Final package clean and minimal (21.6 kB, 8 files)

## 0.9.0 (2025-10-16)

### ⚠️ Beta Release
- Tested on 2022 Chrysler Pacifica
- Expected to work with other Mopar vehicles, but needs community testing
- Feedback and testing reports welcome!

### Background
- Created to replace [homebridge-uconnect](https://github.com/gyahalom/homebridge-uconnect) which stopped working in 2024
- Original plugin's authentication method no longer compatible with Mopar's updated systems
- Last updated August 2022, no longer maintained

### Added
- Initial beta release of homebridge-mopar
- Lock/Unlock door controls
- Remote engine start/stop
- Horn & lights activation
- Climate control (72°F default)
- Battery status monitoring
- Door contact sensors (front left/right, rear left/right, trunk)
- Automated authentication with Puppeteer
- Auto-refresh of session cookies every 20 hours
- Fast startup with intelligent vehicle caching (~5 seconds)
- Background API refresh for cold start reliability
- Automatic cache updates when API becomes available
- Comprehensive error handling and logging
- Voice control through Siri
- Support for all Mopar brands (Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo)

### Technical
- Puppeteer-based automated login
- Cookie-based session management
- Axios with cookie jar support
- Configurable via Homebridge UI
- Config schema for easy setup
- Command debouncing (10 seconds) to prevent duplicates
- Status polling for command completion
- Vehicle data persistence across restarts

## 1.0.0 (TBD)

### Requirements for 1.0.0
- Community testing reports from multiple vehicle models
- Confirmation of compatibility across different Mopar brands
- Bug fixes based on real-world usage

### Planned
- Configurable climate temperature
- Fuel level monitoring (if supported by API)
- Tire pressure monitoring (if supported by API)
- Location tracking (optional)
- Configurable refresh intervals

