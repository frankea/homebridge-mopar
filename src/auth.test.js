/**
 * Tests for MoparAuth
 */

// Mock fs first, before puppeteer loads
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(() => ({
    isDirectory: jest.fn(() => false),
    isFile: jest.fn(() => true),
  })),
  readdirSync: jest.fn(() => []),
}));

jest.mock('puppeteer');

const puppeteer = require('puppeteer');
const fs = require('fs');
const MoparAuth = require('./auth');
const { createMockPage, createMockBrowser, mockPuppeteerLaunch } = require('../test/helpers/puppeteer');

describe('MoparAuth', () => {
  let auth;
  let mockLog;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLog = jest.fn();
    mockLog.error = jest.fn();
    mockLog.warn = jest.fn();

    mockPage = createMockPage({ title: jest.fn().mockResolvedValue('Mopar Owner') });
    mockBrowser = createMockBrowser(mockPage);
    mockPuppeteerLaunch(mockBrowser);

    // Mock fs
    fs.existsSync.mockReturnValue(true);

    // Create auth instance
    auth = new MoparAuth('test@example.com', 'password123', mockLog, false);
  });

  describe('Constructor', () => {
    test('should initialize with credentials', () => {
      expect(auth.email).toBe('test@example.com');
      expect(auth.password).toBe('password123');
      expect(auth.debugMode).toBe(false);
      expect(auth.cookies).toBeNull();
      expect(auth.lastLogin).toBeNull();
    });

    test('should enable debug mode when specified', () => {
      const debugAuth = new MoparAuth('test@example.com', 'pass', mockLog, true);
      expect(debugAuth.debugMode).toBe(true);
    });
  });

  describe('Login', () => {
    beforeEach(() => {
      // Mock successful login flow
      mockPage.$eval
        .mockResolvedValueOnce('test@example.com') // Email verification
        .mockResolvedValueOnce('password123'); // Password verification

      mockPage.evaluate
        .mockResolvedValueOnce({}) // Form validation
        .mockResolvedValueOnce({ method: 'enter-key', attempted: true }) // Form submission
        .mockResolvedValueOnce({ authenticated: true, uid: 'user123' }) // Gigya session
        .mockResolvedValueOnce({
          uid: 'user123',
          uidSignature: 'sig123',
          signatureTimestamp: Date.now(),
        }) // Gigya data
        .mockResolvedValueOnce({}); // POST form

      mockPage.cookies.mockResolvedValue([
        {
          name: 'glt_test',
          value: 'token123',
          domain: '.mopar.com',
        },
        {
          name: 'session_id',
          value: 'session_abc',
          domain: '.mopar.com',
        },
      ]);
    });

    test('should perform successful login', async () => {
      const cookies = await auth.login();

      expect(cookies).toHaveProperty('glt_test');
      expect(cookies).toHaveProperty('session_id');
      expect(puppeteer.launch).toHaveBeenCalled();
      expect(mockPage.goto).toHaveBeenCalledWith('https://www.mopar.com/en-us/sign-in.html', expect.any(Object));
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('should wait for login form elements', async () => {
      await auth.login();

      expect(mockPage.waitForSelector).toHaveBeenCalledWith('input[name="username"]', expect.any(Object));
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('input[name="password"]', expect.any(Object));
    });

    test('should fill in credentials', async () => {
      await auth.login();

      // Should attempt to type credentials
      expect(mockPage.click).toHaveBeenCalled();
      expect(mockPage.type).toHaveBeenCalled();
    });

    test('should update lastLogin timestamp', async () => {
      expect(auth.lastLogin).toBeNull();

      await auth.login();

      expect(auth.lastLogin).toBeInstanceOf(Date);
    });

    test('should store cookies', async () => {
      const cookies = await auth.login();

      expect(auth.cookies).toEqual(cookies);
    });

    test('should handle login errors', async () => {
      mockPage.goto.mockRejectedValue(new Error('Network error'));

      await expect(auth.login()).rejects.toThrow('Network error');
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('should filter cookies to allowed domains', async () => {
      mockPage.cookies.mockResolvedValue([
        {
          name: 'mopar_cookie',
          value: 'value1',
          domain: '.mopar.com',
        },
        {
          name: 'gigya_cookie',
          value: 'value2',
          domain: '.gigya.com',
        },
        {
          name: 'other_cookie',
          value: 'value3',
          domain: '.example.com',
        },
      ]);

      const cookies = await auth.login();

      expect(cookies).toHaveProperty('mopar_cookie');
      expect(cookies).toHaveProperty('gigya_cookie');
      expect(cookies).not.toHaveProperty('other_cookie');
    });

    test('should log login process', async () => {
      await auth.login();

      expect(mockLog).toHaveBeenCalledWith('Starting automated login...');
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Using Chrome at:'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Navigating to login page'));
      expect(mockLog).toHaveBeenCalledWith('Login successful, extracting cookies...');
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Extracted'));
    });

    test('should find Chrome executable', async () => {
      await auth.login();

      expect(fs.existsSync).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Using Chrome at:'));
    });

    test('should handle navigation timeout gracefully', async () => {
      mockPage.waitForNavigation.mockRejectedValue(new Error('Navigation timeout'));
      mockPage.url.mockReturnValue('https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html');

      // Add required mocks for successful completion
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ method: 'enter-key', attempted: true })
        .mockResolvedValue({ authenticated: true, uid: 'user123' })
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() })
        .mockResolvedValue({});
      mockPage.cookies.mockResolvedValue([{ name: 'test', value: 'value', domain: '.mopar.com' }]);

      const cookies = await auth.login();

      expect(cookies).toBeTruthy();
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Navigation timeout'));
    });
  });

  describe('Cookies Validation', () => {
    test('areCookiesValid should return false when no cookies', () => {
      expect(auth.areCookiesValid()).toBe(false);
    });

    test('areCookiesValid should return false when no lastLogin', () => {
      auth.cookies = { test: 'cookie' };
      auth.lastLogin = null;

      expect(auth.areCookiesValid()).toBe(false);
    });

    test('areCookiesValid should return true for fresh cookies', () => {
      auth.cookies = { test: 'cookie' };
      auth.lastLogin = new Date();

      expect(auth.areCookiesValid()).toBe(true);
    });

    test('areCookiesValid should return false for old cookies', () => {
      auth.cookies = { test: 'cookie' };
      const twentyOneHoursAgo = new Date(Date.now() - 21 * 60 * 60 * 1000);
      auth.lastLogin = twentyOneHoursAgo;

      expect(auth.areCookiesValid()).toBe(false);
    });

    test('areCookiesValid should return true at 19 hours', () => {
      auth.cookies = { test: 'cookie' };
      const nineteenHoursAgo = new Date(Date.now() - 19 * 60 * 60 * 1000);
      auth.lastLogin = nineteenHoursAgo;

      expect(auth.areCookiesValid()).toBe(true);
    });
  });

  describe('Get Cookies', () => {
    test('should return existing valid cookies', async () => {
      auth.cookies = { test: 'cookie' };
      auth.lastLogin = new Date();

      const cookies = await auth.getCookies();

      expect(cookies).toEqual({ test: 'cookie' });
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });

    test('should login if cookies are expired', async () => {
      auth.cookies = { test: 'cookie' };
      auth.lastLogin = new Date(Date.now() - 21 * 60 * 60 * 1000);

      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ authenticated: true, uid: 'user123' })
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() });
      mockPage.cookies.mockResolvedValue([{ name: 'new_cookie', value: 'new_value', domain: '.mopar.com' }]);

      const cookies = await auth.getCookies();

      expect(cookies).toHaveProperty('new_cookie');
      expect(puppeteer.launch).toHaveBeenCalled();
    });
  });

  describe('Debug Helper', () => {
    test('should log debug messages when debug mode enabled', () => {
      const debugAuth = new MoparAuth('test@example.com', 'pass', mockLog, true);

      debugAuth.debug('Test debug message');

      expect(mockLog).toHaveBeenCalledWith('[DEBUG] Test debug message');
    });

    test('should not log debug messages when debug mode disabled', () => {
      auth.debug('Test debug message');

      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('Error Scenarios', () => {
    test('should handle form submission errors', async () => {
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate.mockRejectedValue(new Error('Form error'));

      await expect(auth.login()).rejects.toThrow();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('should handle missing login form', async () => {
      mockPage.waitForSelector.mockRejectedValue(new Error('Selector timeout'));

      await expect(auth.login()).rejects.toThrow('Selector timeout');
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('should handle Gigya session errors', async () => {
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValueOnce({}) // Form validation
        .mockResolvedValueOnce({ authenticated: false, error: 'Invalid credentials' }); // Gigya error

      mockPage.url.mockReturnValue('https://www.mopar.com/en-us/sign-in.html'); // Still on sign-in
      mockPage.content.mockResolvedValue('<html>Error message</html>');

      await expect(auth.login()).rejects.toThrow();
    });

    test('should close browser on any error', async () => {
      const error = new Error('Test error');
      mockPage.goto.mockRejectedValue(error);

      await expect(auth.login()).rejects.toThrow('Test error');
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe('Chrome Executable Detection', () => {
    test('should try multiple Chrome paths', async () => {
      let callCount = 0;
      fs.existsSync.mockImplementation(() => {
        callCount++;
        return callCount === 3; // Third path exists
      });

      // Add required mocks for successful completion
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ method: 'enter-key', attempted: true })
        .mockResolvedValue({ authenticated: true, uid: 'user123' })
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() })
        .mockResolvedValue({});
      mockPage.cookies.mockResolvedValue([{ name: 'test', value: 'value', domain: '.mopar.com' }]);

      await auth.login();

      expect(fs.existsSync).toHaveBeenCalled();
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: expect.any(String),
        })
      );
    });

    test('should work without executablePath if none found', async () => {
      fs.existsSync.mockReturnValue(false);

      // Mock successful flow
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ authenticated: true, uid: 'user123' })
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() });
      mockPage.cookies.mockResolvedValue([{ name: 'test', value: 'value', domain: '.mopar.com' }]);

      await auth.login();

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.not.objectContaining({
          executablePath: expect.any(String),
        })
      );
    });
  });

  describe('Cookie Extraction', () => {
    test('should extract glt_ cookies', async () => {
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ authenticated: true, uid: 'user123' })
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() });
      mockPage.cookies.mockResolvedValue([{ name: 'glt_12345', value: 'token_value', domain: '.mopar.com' }]);

      const cookies = await auth.login();

      expect(cookies).toHaveProperty('glt_12345');
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Extracted 1 cookies'));
    });

    test('should extract cookies even without glt_ token', async () => {
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({}) // Form validation
        .mockResolvedValue({ method: 'enter-key', attempted: true }) // Form submission
        .mockResolvedValue({ authenticated: true, uid: 'user123' }) // Gigya session
        .mockResolvedValue({ uid: 'user123', uidSignature: 'sig', signatureTimestamp: Date.now() }) // Gigya data
        .mockResolvedValue({}); // POST form
      // Return cookies without glt_ token
      mockPage.cookies.mockResolvedValue([{ name: 'session', value: 'abc', domain: '.mopar.com' }]);

      const cookies = await auth.login();

      // Should still return cookies even if no glt_ token
      expect(cookies).toHaveProperty('session');
      expect(Object.keys(cookies).some((key) => key.startsWith('glt_'))).toBe(false);
    });
  });

  describe('Puppeteer Configuration', () => {
    test('should launch in headless mode', async () => {
      mockPage.$eval.mockResolvedValue('test@example.com').mockResolvedValue('password123');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ authenticated: true })
        .mockResolvedValue({ uid: 'test', uidSignature: 'sig', signatureTimestamp: Date.now() });
      mockPage.cookies.mockResolvedValue([{ name: 'test', value: 'value', domain: '.mopar.com' }]);

      await auth.login();

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: 'new',
        })
      );
    });

    test('should use security flags', async () => {
      mockPage.$eval.mockResolvedValue('test');
      mockPage.evaluate
        .mockResolvedValue({})
        .mockResolvedValue({ authenticated: true })
        .mockResolvedValue({ uid: 'test', uidSignature: 'sig', signatureTimestamp: Date.now() });
      mockPage.cookies.mockResolvedValue([{ name: 'test', value: 'value', domain: '.mopar.com' }]);

      await auth.login();

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']),
        })
      );
    });
  });
});
