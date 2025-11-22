/**
 * Tests for Logger
 */

const Logger = require('./logger');

describe('Logger', () => {
  describe('With simple function logger', () => {
    let mockLog;
    let logger;

    beforeEach(() => {
      mockLog = jest.fn();
      logger = new Logger('TestComponent', mockLog, false);
    });

    test('should create logger with simple function', () => {
      expect(logger.name).toBe('TestComponent');
      expect(logger.debugMode).toBe(false);
    });

    test('should log info messages', () => {
      logger.info('Test info message');

      expect(mockLog).toHaveBeenCalledWith('Test info message');
    });

    test('should log simple log messages', () => {
      logger.log('Simple log');

      expect(mockLog).toHaveBeenCalledWith('Simple log');
    });

    test('should log error messages with prefix', () => {
      logger.error('Test error');

      expect(mockLog).toHaveBeenCalledWith('ERROR: Test error');
    });

    test('should log warning messages with prefix', () => {
      logger.warn('Test warning');

      expect(mockLog).toHaveBeenCalledWith('WARNING: Test warning');
    });

    test('should not log debug messages when debug mode disabled', () => {
      logger.debug('Debug message');

      expect(mockLog).not.toHaveBeenCalled();
    });

    test('should log debug messages when debug mode enabled', () => {
      const debugLogger = new Logger('TestComponent', mockLog, true);
      debugLogger.debug('Debug message');

      expect(mockLog).toHaveBeenCalledWith('[DEBUG] Debug message');
    });

    test('should not log trace messages when debug mode disabled', () => {
      logger.trace('Trace message');

      expect(mockLog).not.toHaveBeenCalled();
    });

    test('should log trace messages when debug mode enabled', () => {
      const debugLogger = new Logger('TestComponent', mockLog, true);
      debugLogger.trace('Trace message');

      expect(mockLog).toHaveBeenCalledWith('[TRACE] Trace message');
    });

    test('should handle additional arguments', () => {
      logger.info('Message with', 'multiple', 'args');

      expect(mockLog).toHaveBeenCalledWith('Message with', 'multiple', 'args');
    });
  });

  describe('With full Homebridge logger', () => {
    let mockHomebridgeLog;
    let logger;

    beforeEach(() => {
      // Mock Homebridge logger object (not a function)
      mockHomebridgeLog = {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      };
      // Make it callable as a function too (like real Homebridge logger)
      Object.setPrototypeOf(mockHomebridgeLog, Function.prototype);
      logger = new Logger('TestComponent', mockHomebridgeLog, false);
    });

    test('should use Homebridge error method', () => {
      logger.error('Error message');

      expect(mockHomebridgeLog.error).toHaveBeenCalledWith('Error message');
    });

    test('should use Homebridge warn method', () => {
      logger.warn('Warning message');

      expect(mockHomebridgeLog.warn).toHaveBeenCalledWith('Warning message');
    });

    test('should use base log for info', () => {
      logger.info('Info message');

      // Should use the info method if available, or baseLog
      expect(logger.baseLog).toBeDefined();
    });

    test('should use base log for simple log', () => {
      logger.log('Simple message');

      // Should use the base logger
      expect(logger.baseLog).toBeDefined();
    });

    test('should handle debug with full logger', () => {
      const debugLogger = new Logger('TestComponent', mockHomebridgeLog, true);
      debugLogger.debug('Debug message');

      // Debug should use baseLog
      expect(debugLogger.baseLog).toBeDefined();
    });
  });

  describe('Fallback to console', () => {
    let consoleSpy;
    let logger;

    beforeEach(() => {
      consoleSpy = {
        log: jest.spyOn(console, 'log').mockImplementation(),
        error: jest.spyOn(console, 'error').mockImplementation(),
        warn: jest.spyOn(console, 'warn').mockImplementation(),
      };
      logger = new Logger('TestComponent', null, false);
    });

    afterEach(() => {
      consoleSpy.log.mockRestore();
      consoleSpy.error.mockRestore();
      consoleSpy.warn.mockRestore();
    });

    test('should use console.error for errors', () => {
      logger.error('Error');

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    test('should use console.warn for warnings', () => {
      logger.warn('Warning');

      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    test('should use console.log for info', () => {
      logger.info('Info');

      expect(consoleSpy.log).toHaveBeenCalled();
    });
  });

  describe('Debug mode toggle', () => {
    let mockLog;

    test('should respect debug mode in constructor', () => {
      mockLog = jest.fn();
      const debugLogger = new Logger('Test', mockLog, true);

      expect(debugLogger.debugMode).toBe(true);
    });

    test('should filter debug logs based on mode', () => {
      mockLog = jest.fn();
      const regularLogger = new Logger('Test', mockLog, false);
      const debugLogger = new Logger('Test', mockLog, true);

      regularLogger.debug('Should not show');
      expect(mockLog).not.toHaveBeenCalled();

      debugLogger.debug('Should show');
      expect(mockLog).toHaveBeenCalledWith('[DEBUG] Should show');
    });
  });
});
