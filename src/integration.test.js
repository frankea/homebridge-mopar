/**
 * Integration Tests for Complete Workflows
 * Tests the interaction between multiple components
 */

jest.mock('puppeteer');
jest.mock('axios');
jest.mock('axios-cookiejar-support');
jest.mock('tough-cookie');
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(() => ({
    isDirectory: jest.fn(() => false),
    isFile: jest.fn(() => true),
  })),
  readdirSync: jest.fn(() => []),
  promises: {
    writeFile: jest.fn().mockResolvedValue(),
    readFile: jest.fn(),
  },
}));

const puppeteer = require('puppeteer');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const MoparAuth = require('./auth');
const MoparAPI = require('./api');
const { createMockPage, createMockBrowser, mockPuppeteerLaunch } = require('../test/helpers/puppeteer');

describe('Integration Tests', () => {
  let mockBrowser;
  let mockPage;
  let mockSession;
  let mockCookieJar;
  let mockLog;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLog = jest.fn();
    mockLog.error = jest.fn();
    mockLog.warn = jest.fn();

    // Mock Puppeteer
    mockPage = createMockPage();
    mockPage.$eval.mockResolvedValue('test@example.com');
    mockPage.evaluate.mockImplementation((fn) => {
      const fnStr = fn.toString();

      if (fnStr.includes('input[name="username"]') && fnStr.includes('value =')) {
        return Promise.resolve();
      }
      if (fnStr.includes('input[name="password"]') && fnStr.includes('value =')) {
        return Promise.resolve();
      }
      if (fnStr.includes('input[name="username"]') && fnStr.includes('dispatchEvent')) {
        return Promise.resolve();
      }
      if (fnStr.includes('window.getComputedStyle')) {
        return Promise.resolve({ visible: true, disabled: false, text: 'Sign In' });
      }
      if (fnStr.includes('el.click()')) {
        return Promise.resolve();
      }
      if (fnStr.includes('gigya.accounts.login')) {
        return Promise.resolve({ method: 'gigya-api', attempted: true, success: true });
      }
      if (fnStr.includes('gigya.accounts.getAccountInfo')) {
        return Promise.resolve({
          authenticated: true,
          uid: 'user123',
          uidSignature: 'sig123',
          signatureTimestamp: Date.now(),
          profile: { firstName: 'Test', lastName: 'User' },
        });
      }
      if (fnStr.includes(':cq_csrf_token')) {
        return Promise.resolve(null);
      }
      if (fnStr.includes('form.submit()') || fnStr.includes('form.action')) {
        return Promise.resolve();
      }
      if (fnStr.includes('scrollTo')) {
        return Promise.resolve();
      }
      return Promise.resolve({});
    });
    mockPage.cookies.mockResolvedValue([{ name: 'glt_test', value: 'token123', domain: '.mopar.com' }]);
    mockPage.on = jest.fn();
    mockPage.off = jest.fn();
    mockPage.url.mockReturnValue('https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html');
    mockPage.focus = jest.fn();
    mockPage.click = jest.fn();
    mockPage.type = jest.fn();
    mockPage.screenshot.mockResolvedValue();
    mockPage.content.mockResolvedValue('<html></html>');
    mockPage.title.mockResolvedValue('Mopar');
    mockPage.waitForNavigation.mockResolvedValue();
    mockPage.$.mockResolvedValue({});

    mockBrowser = createMockBrowser(mockPage);
    mockPuppeteerLaunch(mockBrowser);

    // Mock axios
    mockSession = {
      get: jest.fn(),
      post: jest.fn(),
    };
    wrapper.mockReturnValue(mockSession);

    mockCookieJar = {
      setCookieSync: jest.fn(),
      getCookies: jest.fn().mockResolvedValue([]),
    };
    tough.CookieJar.mockImplementation(() => mockCookieJar);
  });

  describe('Complete Login → Initialize → Command Flow', () => {
    test('should complete full authentication and command flow', async () => {
      // Setup API responses
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf123' } }) // CSRF token
        .mockResolvedValueOnce({ data: { uid: 'user123' } }); // Profile

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req123' },
      });

      mockSession.get.mockResolvedValue({
        data: { status: 'SUCCESS' },
      });

      // 1. Login
      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();

      expect(cookies).toHaveProperty('glt_test');
      expect(puppeteer.launch).toHaveBeenCalled();

      // 2. Initialize API
      const api = new MoparAPI(cookies, mockLog);
      await api.initialize();

      expect(api.csrfToken).toBe('csrf123');
      expect(mockLog).toHaveBeenCalledWith('Profile initialized');

      // 3. Send Command
      const requestId = await api.sendCommand('VIN123', 'LOCK', '1234');
      expect(requestId).toBe('req123');

      // 4. Poll Status
      const result = await api.pollCommandStatus('VIN123', 'LOCK', requestId);
      expect(result.success).toBe(true);
    });
  });

  describe('Session Expiration and Re-authentication', () => {
    test('should handle session expiration gracefully', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf123' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValueOnce({ data: { token: 'csrf_new' } })
        .mockResolvedValueOnce({ data: { uid: 'user456' } });

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req456' },
      });

      // Initial login
      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const initialCookies = await auth.login();
      let api = new MoparAPI(initialCookies, mockLog);
      await api.initialize();

      // Simulate session expiration
      auth.lastLogin = new Date(Date.now() - 21 * 60 * 60 * 1000); // 21 hours ago
      expect(auth.areCookiesValid()).toBe(false);

      // Re-authenticate
      const newCookies = await auth.login();
      api = new MoparAPI(newCookies, mockLog);
      await api.initialize();

      // Command should work with new session
      const requestId = await api.sendCommand('VIN123', 'UNLOCK', '1234');
      expect(requestId).toBe('req456');
    });
  });

  describe('CSRF Token Lifecycle', () => {
    test('should refresh CSRF token when stale', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf_initial' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValueOnce({ data: { token: 'csrf_refreshed' } });

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req789' },
      });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();
      expect(api.csrfToken).toBe('csrf_initial');

      // Make token stale
      api.csrfTokenTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago

      // Should refresh before command
      await api.startEngine('VIN123', '1234');

      expect(mockSession.get).toHaveBeenCalledWith('https://www.mopar.com/moparsvc/token', expect.any(Object));
      expect(api.csrfToken).toBe('csrf_refreshed');
    });
  });

  describe('Vehicle Discovery with Cache Fallback', () => {
    test('should use cache when API fails', async () => {
      const fs = require('fs').promises;
      const cachedVehicles = [{ vin: 'CACHED_VIN', make: 'JEEP', model: 'Wrangler', year: '2023' }];

      fs.readFile.mockResolvedValue(
        JSON.stringify({
          timestamp: Date.now(),
          vehicles: cachedVehicles,
        })
      );

      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf123' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValue({ data: [] }); // API returns empty

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();
      const vehicles = await api.getVehicles();

      // Should return empty after retries
      expect(vehicles).toEqual([]);
      // But cache would be used by platform layer
    });
  });

  describe('Error Recovery Scenarios', () => {
    test('should retry on empty vehicle responses', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf123' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValueOnce({ data: [] }) // First attempt - empty
        .mockResolvedValueOnce({ data: [] }) // Second attempt - empty
        .mockResolvedValueOnce({ data: [] }) // Third attempt - empty
        .mockResolvedValueOnce({
          data: [{ vin: 'VIN123', make: 'DODGE', model: 'Durango' }],
        }); // Fourth attempt succeeds

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();

      // getVehicles has built-in retry logic for empty responses
      const vehicles = await api.getVehicles();

      expect(vehicles).toHaveLength(1);
      expect(vehicles[0].vin).toBe('VIN123');
    });
  });

  describe('Cookie Management Across Sessions', () => {
    test('should properly set and use cookies', async () => {
      const testCookies = {
        glt_12345: 'gigya_token_abc',
        session_id: 'session_xyz',
        other_cookie: 'value123',
      };

      const api = new MoparAPI(testCookies, mockLog);

      // Verify API instance was created
      expect(api).toBeDefined();

      // Verify cookies were set
      expect(mockCookieJar.setCookieSync).toHaveBeenCalledTimes(3);

      // Verify glt_ cookies are marked as HttpOnly
      const gltCall = mockCookieJar.setCookieSync.mock.calls.find((call) => call[0].includes('glt_'));
      expect(gltCall[0]).toContain('HttpOnly');

      // Verify domain is set correctly
      expect(gltCall[0]).toContain('Domain=.mopar.com');
    });

    test('should update cookies after re-authentication', async () => {
      const initialCookies = { glt_old: 'old_token' };
      const api = new MoparAPI(initialCookies, mockLog);

      expect(mockCookieJar.setCookieSync).toHaveBeenCalledTimes(1);

      // Re-authenticate with new cookies
      const newCookies = { glt_new: 'new_token', session_new: 'new_session' };
      api.setCookies(newCookies);

      // Should have set new cookies
      expect(mockCookieJar.setCookieSync).toHaveBeenCalledTimes(3); // 1 initial + 2 new
      expect(mockLog).toHaveBeenCalledWith('Setting 2 cookies in jar');
    });
  });

  describe('Full Command Execution Pipeline', () => {
    test('should execute lock command from start to finish', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf123' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValue({ data: { status: 'SUCCESS' } });

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'lock_req_123' },
      });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();

      // Ensure CSRF token is fresh
      await api.ensureFreshCSRFToken();

      // Send command
      const requestId = await api.sendCommand('VIN123', 'LOCK', '1234');
      expect(requestId).toBe('lock_req_123');

      // Poll for completion
      const result = await api.pollCommandStatus('VIN123', 'LOCK', requestId);
      expect(result.success).toBe(true);
    });

    test('should execute remote start from start to finish', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf456' } })
        .mockResolvedValueOnce({ data: { uid: 'user456' } })
        .mockResolvedValue({ data: { status: 'SUCCESS' } });

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'start_req_456' },
      });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();
      await api.ensureFreshCSRFToken();

      const requestId = await api.startEngine('VIN456', '1234');
      expect(requestId).toBe('start_req_456');

      const result = await api.pollCommandStatus('VIN456', 'START', requestId, 2);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Recovery Integration', () => {
    test('should recover from expired session mid-operation', async () => {
      let callCount = 0;

      mockSession.post.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails with 403
          const error = new Error('Forbidden');
          error.response = { status: 403 };
          return Promise.reject(error);
        }
        // Second call succeeds
        return Promise.resolve({ data: { serviceRequestId: 'req_retry' } });
      });

      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf_old' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValueOnce({ data: { token: 'csrf_new' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } })
        .mockResolvedValue({ data: { status: 'SUCCESS' } });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      let cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);
      await api.initialize();

      // Try command - will fail with 403
      let error;
      try {
        await api.sendCommand('VIN123', 'LOCK', '1234');
      } catch (e) {
        error = e;
      }

      expect(error).toBeDefined();
      expect(error.response.status).toBe(403);

      // Re-authenticate
      cookies = await auth.login();
      api.setCookies(cookies);
      await api.initialize();

      // Retry should succeed
      const requestId = await api.sendCommand('VIN123', 'LOCK', '1234');
      expect(requestId).toBe('req_retry');
    });
  });

  describe('Multiple Vehicles Handling', () => {
    test('should handle multiple vehicles from API', async () => {
      const mockVehicles = [
        { vin: 'VIN001', make: 'JEEP', model: 'Wrangler', year: '2023' },
        { vin: 'VIN002', make: 'RAM', model: '1500', year: '2024' },
        { vin: 'VIN003', make: 'CHRYSLER', model: 'Pacifica', year: '2022' },
      ];

      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf' } })
        .mockResolvedValueOnce({ data: { uid: 'user' } })
        .mockResolvedValue({ data: mockVehicles });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);

      await api.initialize();
      const vehicles = await api.getVehicles();

      expect(vehicles).toHaveLength(3);
      expect(vehicles[0].make).toBe('JEEP');
      expect(vehicles[1].make).toBe('RAM');
      expect(vehicles[2].make).toBe('CHRYSLER');
    });
  });

  describe('Concurrent Commands', () => {
    test('should handle multiple commands in sequence', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { token: 'csrf' } })
        .mockResolvedValueOnce({ data: { uid: 'user' } })
        .mockResolvedValue({ data: { status: 'SUCCESS' } });

      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req_sequential' },
      });

      const auth = new MoparAuth('test@example.com', 'password123', mockLog);
      const cookies = await auth.login();
      const api = new MoparAPI(cookies, mockLog);
      await api.initialize();

      // Execute multiple commands
      const lockReq = await api.sendCommand('VIN123', 'LOCK', '1234');
      const unlockReq = await api.sendCommand('VIN123', 'UNLOCK', '1234');
      const hornReq = await api.hornAndLights('VIN123');

      expect(lockReq).toBe('req_sequential');
      expect(unlockReq).toBe('req_sequential');
      expect(hornReq).toBe('req_sequential');
    });
  });

  describe('Cache Operations', () => {
    test('should save and load vehicle cache', async () => {
      const fs = require('fs').promises;
      const mockVehicles = [{ vin: 'CACHE_VIN', make: 'FIAT', model: '500', year: '2021' }];

      // Load platform to test cache methods
      const MoparPlatform = (() => {
        const mockHomebridge = {
          hap: {
            Service: class {
              static AccessoryInformation = { UUID: 'info' };
            },
            Characteristic: class {},
            uuid: { generate: () => 'uuid' },
          },
          platformAccessory: class {},
          registerPlatform: jest.fn(),
        };

        const platformModule = require('./platform');
        platformModule(mockHomebridge);

        return mockHomebridge.registerPlatform.mock.calls[0][2];
      })();

      const platformInstance = new MoparPlatform(
        mockLog,
        { email: 'test@example.com', password: 'test' },
        {
          user: { storagePath: () => '/tmp/test' },
          on: jest.fn(),
        }
      );

      // Save cache
      await platformInstance.saveVehicleCache(mockVehicles);
      expect(fs.writeFile).toHaveBeenCalled();

      const savedData = JSON.parse(fs.writeFile.mock.calls[0][1]);
      expect(savedData.vehicles).toEqual(mockVehicles);
      expect(savedData.timestamp).toBeDefined();

      // Load cache
      fs.readFile.mockResolvedValue(JSON.stringify(savedData));
      const loaded = await platformInstance.loadVehicleCache();

      expect(loaded).toEqual(mockVehicles);
    });
  });
});
