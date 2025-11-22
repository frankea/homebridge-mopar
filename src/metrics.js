/**
 * Local Metrics Collector
 *
 * PRIVACY GUARANTEE: All metrics stay on the user's local machine.
 * NO external calls, NO tracking, NO data transmission.
 *
 * Purpose: Help users debug issues by tracking local statistics.
 * Metrics are only visible when debug logging is enabled.
 */

class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.commands = new Map(); // command -> { success: 0, failure: 0, totalTime: 0 }
    this.apiCalls = new Map(); // endpoint -> { count: 0, errors: 0 }
    this.errors = new Map(); // error type -> count
    this.sessionRefreshes = { success: 0, failure: 0 };
    this.cookieRefreshes = { success: 0, failure: 0 };
    this.logins = { success: 0, failure: 0 };
  }

  /**
   * Record a command execution
   * @param {string} command - Command type (lock, unlock, start, etc.)
   * @param {boolean} success - Whether command succeeded
   * @param {number} duration - Execution time in milliseconds
   */
  recordCommand(command, success, duration = 0) {
    if (!this.commands.has(command)) {
      this.commands.set(command, { success: 0, failure: 0, totalTime: 0, count: 0 });
    }

    const stats = this.commands.get(command);
    stats.count++;
    stats.totalTime += duration;

    if (success) {
      stats.success++;
    } else {
      stats.failure++;
    }
  }

  /**
   * Record an API call
   * @param {string} endpoint - API endpoint name
   * @param {boolean} success - Whether call succeeded
   */
  recordAPICall(endpoint, success) {
    if (!this.apiCalls.has(endpoint)) {
      this.apiCalls.set(endpoint, { count: 0, errors: 0 });
    }

    const stats = this.apiCalls.get(endpoint);
    stats.count++;

    if (!success) {
      stats.errors++;
    }
  }

  /**
   * Record an error occurrence
   * @param {string} errorType - Type of error (e.g., 'NETWORK', 'AUTH', 'TIMEOUT')
   */
  recordError(errorType) {
    const count = this.errors.get(errorType) || 0;
    this.errors.set(errorType, count + 1);
  }

  /**
   * Record a session refresh attempt
   * @param {boolean} success - Whether refresh succeeded
   */
  recordSessionRefresh(success) {
    if (success) {
      this.sessionRefreshes.success++;
    } else {
      this.sessionRefreshes.failure++;
    }
  }

  /**
   * Record a cookie refresh attempt
   * @param {boolean} success - Whether refresh succeeded
   */
  recordCookieRefresh(success) {
    if (success) {
      this.cookieRefreshes.success++;
    } else {
      this.cookieRefreshes.failure++;
    }
  }

  /**
   * Record a login attempt
   * @param {boolean} success - Whether login succeeded
   */
  recordLogin(success) {
    if (success) {
      this.logins.success++;
    } else {
      this.logins.failure++;
    }
  }

  /**
   * Get summary statistics
   * @returns {object} Summary of all metrics
   */
  getSummary() {
    const uptime = Date.now() - this.startTime;
    const uptimeMinutes = Math.floor(uptime / 60000);
    const uptimeHours = Math.floor(uptime / 3600000);

    return {
      uptime: {
        milliseconds: uptime,
        minutes: uptimeMinutes,
        hours: uptimeHours,
        formatted: this.formatUptime(uptime),
      },
      commands: this.getCommandStats(),
      logins: this.logins,
      sessionRefreshes: this.sessionRefreshes,
      cookieRefreshes: this.cookieRefreshes,
      apiCalls: this.getAPICallStats(),
      errors: this.getErrorStats(),
    };
  }

  /**
   * Get command statistics
   * @returns {object} Command stats by type
   */
  getCommandStats() {
    const stats = {};
    this.commands.forEach((value, key) => {
      const avgTime = value.count > 0 ? Math.round(value.totalTime / value.count) : 0;
      const successRate = value.count > 0 ? Math.round((value.success / value.count) * 100) : 0;

      stats[key] = {
        total: value.count,
        success: value.success,
        failure: value.failure,
        successRate: `${successRate}%`,
        avgDuration: `${avgTime}ms`,
      };
    });
    return stats;
  }

  /**
   * Get API call statistics
   * @returns {object} API call stats by endpoint
   */
  getAPICallStats() {
    const stats = {};
    this.apiCalls.forEach((value, key) => {
      const errorRate = value.count > 0 ? Math.round((value.errors / value.count) * 100) : 0;
      stats[key] = {
        total: value.count,
        errors: value.errors,
        errorRate: `${errorRate}%`,
      };
    });
    return stats;
  }

  /**
   * Get error statistics
   * @returns {object} Error counts by type
   */
  getErrorStats() {
    const stats = {};
    this.errors.forEach((value, key) => {
      stats[key] = value;
    });
    return stats;
  }

  /**
   * Format uptime in human-readable format
   * @param {number} milliseconds - Uptime in milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(milliseconds) {
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor((milliseconds % 3600000) / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Log metrics summary (only in debug mode)
   * @param {function} log - Logger function
   */
  logSummary(log) {
    const summary = this.getSummary();

    log('[METRICS] ========================================');
    log(`[METRICS] Plugin Uptime: ${summary.uptime.formatted}`);
    log('[METRICS] ========================================');

    // Command statistics
    if (Object.keys(summary.commands).length > 0) {
      log('[METRICS] Command Statistics:');
      Object.entries(summary.commands).forEach(([cmd, stats]) => {
        log(`[METRICS]   ${cmd}: ${stats.total} total, ${stats.successRate} success, avg ${stats.avgDuration}`);
      });
    }

    // Login statistics
    const totalLogins = summary.logins.success + summary.logins.failure;
    if (totalLogins > 0) {
      log(`[METRICS] Logins: ${summary.logins.success} success, ${summary.logins.failure} failure`);
    }

    // Session refresh statistics
    const totalSessionRefreshes = summary.sessionRefreshes.success + summary.sessionRefreshes.failure;
    if (totalSessionRefreshes > 0) {
      log(
        `[METRICS] Session Refreshes: ${summary.sessionRefreshes.success} success, ${summary.sessionRefreshes.failure} failure`
      );
    }

    // Cookie refresh statistics
    const totalCookieRefreshes = summary.cookieRefreshes.success + summary.cookieRefreshes.failure;
    if (totalCookieRefreshes > 0) {
      log(
        `[METRICS] Cookie Refreshes: ${summary.cookieRefreshes.success} success, ${summary.cookieRefreshes.failure} failure`
      );
    }

    // Error statistics
    if (Object.keys(summary.errors).length > 0) {
      log('[METRICS] Error Counts:');
      Object.entries(summary.errors).forEach(([type, count]) => {
        log(`[METRICS]   ${type}: ${count}`);
      });
    }

    log('[METRICS] ========================================');
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.startTime = Date.now();
    this.commands.clear();
    this.apiCalls.clear();
    this.errors.clear();
    this.sessionRefreshes = { success: 0, failure: 0 };
    this.cookieRefreshes = { success: 0, failure: 0 };
    this.logins = { success: 0, failure: 0 };
  }
}

module.exports = Metrics;
