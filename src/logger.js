/**
 * Logger Wrapper
 * Provides consistent logging interface across all classes
 * Wraps Homebridge logger or provides fallback for testing
 */

class Logger {
  /**
   * Create a logger instance
   * @param {string} name - Component name for log prefixing
   * @param {object|function} homebridgeLog - Homebridge log object or simple log function
   * @param {boolean} debugMode - Enable debug logging
   */
  constructor(name, homebridgeLog, debugMode = false) {
    this.name = name;
    this.debugMode = debugMode;

    // Handle both full Homebridge logger object and simple function
    if (homebridgeLog && typeof homebridgeLog === 'object' && typeof homebridgeLog.error === 'function') {
      // Full Homebridge logger object
      this.baseLog = homebridgeLog.info?.bind(homebridgeLog) || console.log;
      this._error = homebridgeLog.error.bind(homebridgeLog);
      this._warn = homebridgeLog.warn?.bind(homebridgeLog) || null;
    } else if (typeof homebridgeLog === 'function') {
      // Simple function - create wrapper methods
      this.baseLog = homebridgeLog;
      this._error = null;
      this._warn = null;
    } else {
      // Fallback to console
      this.baseLog = console.log;
      this._error = console.error;
      this._warn = console.warn;
    }
  }

  /**
   * Log an error message
   * @param {string} message - Error message
   * @param {...any} args - Additional arguments
   */
  error(message, ...args) {
    if (this._error) {
      this._error(message, ...args);
    } else {
      this.baseLog(`ERROR: ${message}`, ...args);
    }
  }

  /**
   * Log a warning message
   * @param {string} message - Warning message
   * @param {...any} args - Additional arguments
   */
  warn(message, ...args) {
    if (this._warn) {
      this._warn(message, ...args);
    } else {
      this.baseLog(`WARNING: ${message}`, ...args);
    }
  }

  /**
   * Log an info message
   * @param {string} message - Info message
   * @param {...any} args - Additional arguments
   */
  info(message, ...args) {
    if (typeof this.baseLog === 'function') {
      this.baseLog(message, ...args);
    }
  }

  /**
   * Log a debug message (only when debug mode enabled)
   * @param {string} message - Debug message
   * @param {...any} args - Additional arguments
   */
  debug(message, ...args) {
    if (this.debugMode) {
      this.baseLog(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Log a trace message (only when debug mode enabled)
   * @param {string} message - Trace message
   * @param {...any} args - Additional arguments
   */
  trace(message, ...args) {
    if (this.debugMode) {
      this.baseLog(`[TRACE] ${message}`, ...args);
    }
  }

  /**
   * Simple log (passes through to base logger)
   * @param {string} message - Message
   * @param {...any} args - Additional arguments
   */
  log(message, ...args) {
    if (typeof this.baseLog === 'function') {
      this.baseLog(message, ...args);
    }
  }
}

module.exports = Logger;
