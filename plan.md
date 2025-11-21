## Implementation Plan

1. **PIN enforcement & UX feedback**  
   - Update [`src/config-validator.js`](src/config-validator.js:12) to require a 4-digit `pin` with explicit messaging for invalid/missing entries and adjust [`src/config-validator.test.js`](src/config-validator.test.js:1) accordingly.  
   - Ensure platform commands (`sendCommand`, `startEngine`, etc.) in [`src/platform.js`](src/platform.js:418) short-circuit with actionable log errors when `this.pin` is absent, and surface guidance during initialization errors plus README/CHANGELOG/config schema updates.

2. **Contact sensor service fix**  
   - Modify `startStatusUpdates()` in [`src/platform.js`](src/platform.js:985) to use `getServiceById(Service.ContactSensor, subtype)` for door/trunk sensors so updates reach HomeKit; extend [`src/platform.test.js`](src/platform.test.js:1) to verify the new lookup behavior.

3. **Lock service refactor**  
   - Replace the dual lock/unlock `Service.LockMechanism` setup with a single service exposing both current/target states per vehicle in [`src/platform.js`](src.platform.js:418), consolidate command routing/debouncing, and update status synchronization plus tests.

4. **Diagnostics sanitization & modular MoparAuth**  
   - Break `MoparAuth.login()` in [`src/auth.js`](src/auth.js:31) into helper methods (browser launch, navigation, credential entry, submission, diagnostics, cookie extraction).  
   - Add a default-off debug flag controlling diagnostic artifacts; when disabled, skip screenshot/HTML writes and ensure any stored artifacts mask credentials before disk writes. Update [`src/auth.test.js`](src/auth.test.js:1) accordingly.

5. **Timer lifecycle management**  
   - Track interval/timeout handles from `startStatusUpdates()` and `scheduleCookieRefresh()` in [`src/platform.js`](src/platform.js:985) so they can be cleared on shutdown/accessory removal (e.g., via `api.on('shutdown', ...)`). Validate via new platform/integration tests.

6. **Rate limiter cleanup**  
   - Add pruning of stale VIN entries in `RateLimiter.requests` within [`src/rate-limiter.js`](src/rate-limiter.js:8) based on window expiry or a max map size, plus tests in [`src/rate-limiter.test.js`](src/rate-limiter.test.js:1) covering eviction.

7. **Expanded automated tests**  
   - Enhance config/platform/auth/rate-limiter/integration suites to cover new behaviors: mandatory PIN, single-lock service, sanitized diagnostics, timer cleanup, contact sensor updates, and limiter pruning.

8. **Documentation updates**  
   - Revise [`README.md`](README.md:48) configuration table, [`config.schema.json`](config.schema.json:1) descriptions, and [`CHANGELOG.md`](CHANGELOG.md:7) entries to reflect PIN requirements, diagnostics flag, lock architecture changes, and timer/limiter behavior.

9. **Branch & sequencing guidance**  
   - Implement work on a new branch (e.g., `feature/pin-lock-refactor`). Suggested order: config/doc updates → platform service changes (locks/sensors/timers) → rate limiter pruning → MoparAuth modularization → expanded tests → final README/CHANGELOG polish.