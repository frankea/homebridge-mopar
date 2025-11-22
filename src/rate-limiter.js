/**
 * Rate Limiter
 * Prevents API abuse and potential account blocks by limiting command frequency
 */

class RateLimiter {
  constructor() {
    // Map of command types to their timestamp history
    this.requests = new Map(); // command -> timestamps[]

    // Rate limits for different command types
    // window is in milliseconds
    this.limits = {
      start: { count: 3, window: 3600000 }, // 3 starts per hour (1 hour)
      stop: { count: 3, window: 3600000 }, // 3 stops per hour
      lock: { count: 10, window: 300000 }, // 10 locks per 5 minutes
      unlock: { count: 10, window: 300000 }, // 10 unlocks per 5 minutes
      hornLights: { count: 5, window: 300000 }, // 5 horn activations per 5 minutes
      climate: { count: 5, window: 600000 }, // 5 climate changes per 10 minutes
      refresh: { count: 10, window: 600000 }, // 10 refreshes per 10 minutes
    };
  }

  /**
   * Check if a command can be executed based on rate limits
   * @param {string} command - Command type (start, lock, unlock, etc.)
   * @param {string} vin - Vehicle VIN (for per-vehicle limiting)
   * @returns {object} { allowed: boolean, waitTime?: number }
   */
  canExecute(command, vin = '') {
    const now = Date.now();
    const limit = this.limits[command];

    if (!limit) {
      // No limit defined for this command - allow it
      return { allowed: true };
    }

    // Use command+vin as key for per-vehicle rate limiting
    const key = `${command}_${vin}`;
    const history = this.requests.get(key) || [];

    // Remove old requests outside the time window
    const recent = history.filter((timestamp) => now - timestamp < limit.window);

    // Check if we've hit the limit
    if (recent.length >= limit.count) {
      const oldestRequest = Math.min(...recent);
      const waitTime = limit.window - (now - oldestRequest);

      return {
        allowed: false,
        waitTime,
        waitMinutes: Math.ceil(waitTime / 60000),
        limit: `${limit.count} per ${this.formatWindow(limit.window)}`,
      };
    }

    // Add this request to history
    recent.push(now);
    this.requests.set(key, recent);

    return { allowed: true };
  }

  /**
   * Format time window in human-readable format
   * @param {number} milliseconds - Time window in milliseconds
   * @returns {string} Human-readable time (e.g. "5 minutes", "1 hour")
   */
  formatWindow(milliseconds) {
    const minutes = milliseconds / 60000;
    const hours = milliseconds / 3600000;

    if (hours >= 1) {
      return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }

  /**
   * Get current usage stats for a command
   * @param {string} command - Command type
   * @param {string} vin - Vehicle VIN
   * @returns {object} { count: number, limit: number, window: string }
   */
  getUsageStats(command, vin = '') {
    const now = Date.now();
    const limit = this.limits[command];

    if (!limit) {
      return { count: 0, limit: null, window: null };
    }

    const key = `${command}_${vin}`;
    const history = this.requests.get(key) || [];
    const recent = history.filter((timestamp) => now - timestamp < limit.window);

    return {
      count: recent.length,
      limit: limit.count,
      window: this.formatWindow(limit.window),
      remaining: limit.count - recent.length,
    };
  }

  /**
   * Clear rate limit history for a specific command/vin
   * Useful for testing or manual reset
   * @param {string} command - Command type
   * @param {string} vin - Vehicle VIN
   */
  reset(command, vin = '') {
    const key = `${command}_${vin}`;
    this.requests.delete(key);
  }

  /**
   * Clear all rate limit history
   */
  resetAll() {
    this.requests.clear();
  }
}

module.exports = RateLimiter;
