/**
 * Configuration Validator
 * Validates plugin configuration with helpful error messages
 */

class ConfigValidator {
  /**
   * Validate the configuration
   * @param {object} config - Plugin configuration
   * @returns {object} { valid: boolean, errors: string[] }
   */
  static validate(config) {
    const errors = [];

    // Email validation
    if (!config.email) {
      errors.push('Email is required');
    } else if (!this.isValidEmail(config.email)) {
      errors.push('Email format is invalid (must be a valid email address)');
    }

    // Password validation - only basic checks
    // Mopar.com requirements vary and existing passwords should work
    if (!config.password) {
      errors.push('Password is required');
    } else {
      const password = config.password;
      
      // Only validate minimum length - existing passwords may not meet current Mopar requirements
      if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
      }
      
      // Warn if password seems too long (Mopar used to have 16 char limit)
      if (password.length > 20) {
        errors.push('Password seems unusually long (may not work with Mopar.com)');
      }
    }

    // PIN validation (required)
    if (!config.pin) {
      errors.push('4-digit vehicle PIN is required for remote commands');
    } else if (!/^\d{4}$/.test(config.pin)) {
      errors.push('PIN must be exactly 4 digits (e.g. "1234")');
    }

    // Debug mode validation (optional field)
    if (config.debug !== undefined && typeof config.debug !== 'boolean') {
      errors.push('Debug mode must be true or false');
    }

    // Platform name validation (optional field)
    if (config.name && typeof config.name !== 'string') {
      errors.push('Platform name must be a string');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if email format is valid
   * @param {string} email - Email address to validate
   * @returns {boolean} True if email format is valid
   */
  static isValidEmail(email) {
    // Basic email validation regex - checks for user@domain.tld format
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /**
   * Log validation errors in a user-friendly format
   * @param {string[]} errors - Array of error messages
   * @param {object} log - Homebridge logger object
   */
  static logErrors(errors, log) {
    log.error('========================================');
    log.error('CONFIGURATION ERRORS');
    log.error('========================================');
    errors.forEach((error, index) => {
      log.error(`${index + 1}. ${error}`);
    });
    log.error('========================================');
    log.error('Please fix these errors in your config.json or Homebridge UI');
    log.error('Then restart Homebridge');
  }
}

module.exports = ConfigValidator;
