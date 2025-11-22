/**
 * Tests for MoparAPI
 */

jest.mock('axios');
jest.mock('axios-cookiejar-support');
jest.mock('tough-cookie');

const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const MoparAPI = require('./api');

describe('MoparAPI', () => {
  let api;
  let mockLog;
  let mockSession;
  let mockCookieJar;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock logger
    mockLog = jest.fn();
    mockLog.error = jest.fn();
    mockLog.warn = jest.fn();

    // Mock axios session
    mockSession = {
      get: jest.fn(),
      post: jest.fn(),
    };

    // Mock axios wrapper
    wrapper.mockReturnValue(mockSession);

    // Mock cookie jar
    mockCookieJar = {
      setCookieSync: jest.fn(),
      getCookies: jest.fn().mockResolvedValue([]),
    };
    tough.CookieJar.mockImplementation(() => mockCookieJar);

    // Create API instance with test cookies
    const testCookies = {
      glt_test: 'test_token_123',
      session_id: 'session_abc',
    };

    api = new MoparAPI(testCookies, mockLog, false);
  });

  describe('Constructor', () => {
    test('should initialize with cookies', () => {
      expect(api.csrfToken).toBeNull();
      expect(api.csrfTokenTimestamp).toBeNull();
      expect(api.baseURL).toBe('https://www.mopar.com');
    });

    test('should throw error if cookies are null', () => {
      expect(() => new MoparAPI(null, mockLog)).toThrow('Cookies parameter is required');
    });

    test('should throw error if cookies are undefined', () => {
      expect(() => new MoparAPI(undefined, mockLog)).toThrow('Cookies parameter is required');
    });

    test('should set cookies in jar', () => {
      expect(mockCookieJar.setCookieSync).toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Setting 2 cookies'));
    });
  });

  describe('CSRF Token Management', () => {
    test('getCSRFToken should fetch and store token', async () => {
      mockSession.get.mockResolvedValue({
        data: { token: 'csrf_token_abc123' },
      });

      const token = await api.getCSRFToken();

      expect(token).toBe('csrf_token_abc123');
      expect(api.csrfToken).toBe('csrf_token_abc123');
      expect(api.csrfTokenTimestamp).toBeTruthy();
      expect(mockSession.get).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/token',
        expect.objectContaining({
          headers: expect.objectContaining({
            Referer: 'https://www.mopar.com/chrysler/en-us/my-vehicle/dashboard.html',
          }),
        })
      );
    });

    test('getCSRFToken should retry once before succeeding', async () => {
      mockSession.get
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ data: { token: 'csrf_retry' } });

      const token = await api.getCSRFToken();

      expect(token).toBe('csrf_retry');
      expect(mockSession.get).toHaveBeenCalledTimes(2);
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('CSRF token fetch failed'));
    });

    test('ensureFreshCSRFToken should not refresh if token is fresh', async () => {
      api.csrfToken = 'existing_token';
      api.csrfTokenTimestamp = Date.now(); // Fresh token

      await api.ensureFreshCSRFToken();

      expect(mockSession.get).not.toHaveBeenCalled();
    });

    test('ensureFreshCSRFToken should refresh if token is missing', async () => {
      api.csrfToken = null;
      mockSession.get.mockResolvedValue({
        data: { token: 'new_token' },
      });

      await api.ensureFreshCSRFToken();

      expect(mockSession.get).toHaveBeenCalled();
      expect(api.csrfToken).toBe('new_token');
    });

    test('ensureFreshCSRFToken should refresh if token is stale', async () => {
      const ELEVEN_MINUTES = 11 * 60 * 1000;
      api.csrfToken = 'old_token';
      api.csrfTokenTimestamp = Date.now() - ELEVEN_MINUTES;

      mockSession.get.mockResolvedValue({
        data: { token: 'refreshed_token' },
      });

      await api.ensureFreshCSRFToken();

      expect(mockSession.get).toHaveBeenCalled();
      expect(api.csrfToken).toBe('refreshed_token');
    });

    test('ensureFreshCSRFToken should handle refresh failure gracefully', async () => {
      api.csrfToken = null;
      mockSession.get.mockRejectedValue(new Error('Network error'));

      await api.ensureFreshCSRFToken();

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Failed to refresh CSRF token'));
    });
  });

  describe('Initialize', () => {
    test('should get CSRF token and profile', async () => {
      mockSession.get.mockResolvedValue({
        data: { token: 'csrf123' },
      });
      mockSession.get
        .mockResolvedValueOnce({
          data: { token: 'csrf123' },
        })
        .mockResolvedValueOnce({
          data: { uid: 'user123' },
        });

      await api.initialize();

      expect(mockSession.get).toHaveBeenCalledTimes(2);
      expect(mockLog).toHaveBeenCalledWith('Profile initialized');
    });

    test('should continue if CSRF token fetch fails', async () => {
      mockSession.get
        .mockRejectedValueOnce(new Error('Token error'))
        .mockResolvedValueOnce({ data: { token: 'csrf123' } })
        .mockResolvedValueOnce({ data: { uid: 'user123' } });

      await api.initialize();

      expect(mockLog).toHaveBeenCalledWith('Profile initialized');
      expect(mockSession.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('Get Profile', () => {
    test('should fetch user profile', async () => {
      const mockProfile = {
        uid: 'user_123',
        email: 'test@example.com',
        firstName: 'Test',
      };

      mockSession.get.mockResolvedValue({
        data: mockProfile,
      });

      const profile = await api.getProfile();

      expect(profile).toEqual(mockProfile);
      expect(mockSession.get).toHaveBeenCalledWith(
        expect.stringContaining('/moparsvc/user/getProfile'),
        expect.any(Object)
      );
    });

    test('should retry on 403 error and succeed', async () => {
      mockSession.get
        .mockResolvedValueOnce({
          data: { errorCode: '403', errorDesc: 'Unauthorized Access', status: 'failed' },
        })
        .mockResolvedValueOnce({
          data: { errorCode: '403', errorDesc: 'Unauthorized Access', status: 'failed' },
        })
        .mockResolvedValueOnce({
          data: { uid: 'user123' },
        });

      const profile = await api.getProfile();

      expect(profile.uid).toBe('user123');
      expect(mockSession.get).toHaveBeenCalledTimes(3);
    });

    test('should fail after max retries on persistent 403', async () => {
      mockSession.get.mockResolvedValue({
        data: { errorCode: '403', errorDesc: 'Unauthorized Access', status: 'failed' },
      });

      await expect(api.getProfile()).rejects.toThrow('Profile request failed: Unauthorized Access (403)');
      expect(mockSession.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('Get Vehicles', () => {
    test('should return vehicles on first attempt', async () => {
      const mockVehicles = [{ vin: 'VIN123', make: 'JEEP', model: 'Wrangler', year: '2023' }];

      mockSession.get.mockResolvedValue({
        status: 200,
        data: mockVehicles,
      });

      const vehicles = await api.getVehicles();

      expect(vehicles).toEqual(mockVehicles);
      expect(mockSession.get).toHaveBeenCalledTimes(1);
    });

    test('should retry if first attempt returns empty', async () => {
      const mockVehicles = [{ vin: 'VIN456', make: 'RAM', model: '1500', year: '2024' }];

      mockSession.get
        .mockResolvedValueOnce({ status: 200, data: [] })
        .mockResolvedValueOnce({ status: 200, data: mockVehicles });

      const vehicles = await api.getVehicles();

      expect(vehicles).toEqual(mockVehicles);
      expect(mockSession.get).toHaveBeenCalledTimes(2);
    });

    test('should return empty array after max retries', async () => {
      mockSession.get.mockResolvedValue({
        status: 200,
        data: [],
      });

      const vehicles = await api.getVehicles();

      expect(vehicles).toEqual([]);
      expect(mockSession.get).toHaveBeenCalledTimes(4); // maxRetries = 4
    });

    test('should handle vehicles in data.vehicles format', async () => {
      const mockVehicles = [{ vin: 'VIN789', make: 'CHRYSLER', model: 'Pacifica' }];

      mockSession.get.mockResolvedValue({
        status: 200,
        data: { vehicles: mockVehicles },
      });

      const vehicles = await api.getVehicles();

      expect(vehicles).toEqual(mockVehicles);
    });
  });

  describe('Get Vehicles Quick', () => {
    test('should return vehicles without retry', async () => {
      const mockVehicles = [{ vin: 'VIN123', make: 'DODGE', model: 'Durango' }];

      mockSession.get.mockResolvedValue({
        status: 200,
        data: mockVehicles,
      });

      const vehicles = await api.getVehiclesQuick();

      expect(vehicles).toEqual(mockVehicles);
      expect(mockSession.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('Send Command', () => {
    beforeEach(async () => {
      // Setup CSRF token
      api.csrfToken = 'test_csrf_token';
      api.csrfTokenTimestamp = Date.now();
    });

    test('should send lock command and return request ID', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req123' },
      });

      const requestId = await api.sendCommand('VIN123', 'LOCK', '1234');

      expect(requestId).toBe('req123');
      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/lock',
        expect.stringContaining('action=LOCK'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'mopar-csrf-salt': 'test_csrf_token',
          }),
        })
      );
    });

    test('should throw error if no service request ID returned', async () => {
      mockSession.post.mockResolvedValue({
        data: {},
      });

      await expect(api.sendCommand('VIN123', 'LOCK', '1234')).rejects.toThrow('No service request ID received');
    });

    test('should refresh CSRF token before sending command', async () => {
      api.csrfToken = null;
      mockSession.get.mockResolvedValue({
        data: { token: 'new_csrf' },
      });
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req456' },
      });

      await api.sendCommand('VIN123', 'UNLOCK', '1234');

      expect(mockSession.get).toHaveBeenCalled(); // CSRF refresh
      expect(mockSession.post).toHaveBeenCalled(); // Command
    });
  });

  describe('Start Engine', () => {
    beforeEach(() => {
      api.csrfToken = 'test_csrf';
      api.csrfTokenTimestamp = Date.now();
    });

    test('should send start engine command', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'start_req_123' },
      });

      const requestId = await api.startEngine('VIN123', '1234');

      expect(requestId).toBe('start_req_123');
      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/engine',
        expect.stringContaining('action=START'),
        expect.any(Object)
      );
    });

    test('should refresh CSRF token if stale', async () => {
      api.csrfToken = 'old_token';
      api.csrfTokenTimestamp = Date.now() - 11 * 60 * 1000; // 11 minutes ago

      mockSession.get.mockResolvedValue({
        data: { token: 'fresh_token' },
      });
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'req789' },
      });

      await api.startEngine('VIN123', '1234');

      expect(mockSession.get).toHaveBeenCalled(); // CSRF refresh
      expect(api.csrfToken).toBe('fresh_token');
    });
  });

  describe('Stop Engine', () => {
    beforeEach(() => {
      api.csrfToken = 'test_csrf';
      api.csrfTokenTimestamp = Date.now();
    });

    test('should send stop engine command', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'stop_req_123' },
      });

      const requestId = await api.stopEngine('VIN123', '1234');

      expect(requestId).toBe('stop_req_123');
      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/engine',
        expect.stringContaining('action=STOP'),
        expect.any(Object)
      );
    });
  });

  describe('Horn and Lights', () => {
    beforeEach(() => {
      api.csrfToken = 'test_csrf';
      api.csrfTokenTimestamp = Date.now();
    });

    test('should send horn and lights command', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'horn_req_123' },
      });

      const requestId = await api.hornAndLights('VIN123');

      expect(requestId).toBe('horn_req_123');
      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/hornlights',
        expect.stringContaining('vin=VIN123'),
        expect.any(Object)
      );
    });
  });

  describe('Set Climate', () => {
    beforeEach(() => {
      api.csrfToken = 'test_csrf';
      api.csrfTokenTimestamp = Date.now();
    });

    test('should send climate command with temperature', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'climate_req_123' },
      });

      const requestId = await api.setClimate('VIN123', '1234', 72);

      expect(requestId).toBe('climate_req_123');
      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/climate',
        expect.stringContaining('temperature=72'),
        expect.any(Object)
      );
    });

    test('should use default duration if not specified', async () => {
      mockSession.post.mockResolvedValue({
        data: { serviceRequestId: 'climate_req_456' },
      });

      await api.setClimate('VIN123', '1234', 68);

      expect(mockSession.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('duration=10'),
        expect.any(Object)
      );
    });
  });

  describe('Poll Command Status', () => {
    test('should return success on successful command', async () => {
      mockSession.get.mockResolvedValue({
        data: { status: 'SUCCESS' },
      });

      const result = await api.pollCommandStatus('VIN123', 'LOCK', 'req123');

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCESS');
    });

    test('should return failure on failed command', async () => {
      mockSession.get.mockResolvedValue({
        data: { status: 'FAILED' },
      });

      const result = await api.pollCommandStatus('VIN123', 'UNLOCK', 'req456');

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
    });

    test('should poll multiple times for pending status', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { status: 'PENDING' } })
        .mockResolvedValueOnce({ data: { status: 'PENDING' } })
        .mockResolvedValueOnce({ data: { status: 'SUCCESS' } });

      const result = await api.pollCommandStatus('VIN123', 'START', 'req789', 5);

      expect(result.success).toBe(true);
      expect(mockSession.get).toHaveBeenCalledTimes(3);
    });

    test('should timeout after max attempts', async () => {
      mockSession.get.mockResolvedValue({
        data: { status: 'PENDING' },
      });

      const result = await api.pollCommandStatus('VIN123', 'STOP', 'req101', 3);

      expect(result.success).toBe(false);
      expect(result.status).toBe('TIMEOUT');
      expect(mockSession.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('Get Vehicle Status', () => {
    test('should return status from VHR data when available', async () => {
      mockSession.get.mockResolvedValueOnce({
        data: {
          available: true,
          doors: {
            frontLeft: 'CLOSED',
            frontRight: 'CLOSED',
            rearLeft: 'OPEN',
            rearRight: 'CLOSED',
            trunk: 'CLOSED',
          },
          locked: true,
          battery: { level: 85 },
          engine: 'OFF',
        },
      });

      const status = await api.getVehicleStatus('VIN123');

      expect(status.available).toBe(true);
      expect(status.doorStatus.frontLeft).toBe('CLOSED');
      expect(status.doorStatus.rearLeft).toBe('OPEN');
      expect(status.lockStatus).toBe('LOCKED');
      expect(status.batteryLevel).toBe(85);
      expect(status.engineRunning).toBe(false);
    });

    test('should fall back to vehicle list when VHR not available', async () => {
      // VHR returns not available
      mockSession.get.mockResolvedValueOnce({
        data: { available: false },
      });

      // getVehiclesQuick returns basic data
      mockSession.get.mockResolvedValueOnce({
        data: [
          {
            vin: 'VIN123',
            lockStatus: 'LOCKED',
            odometer: 15000,
          },
        ],
      });

      const status = await api.getVehicleStatus('VIN123');

      expect(status.available).toBe(true);
      expect(status.lockStatus).toBe('LOCKED');
      expect(status.odometer).toBe(15000);
      expect(status.doorStatus).toBeDefined();
    });

    test('should return error when no data available', async () => {
      mockSession.get
        .mockResolvedValueOnce({ data: { available: false } }) // VHR
        .mockResolvedValueOnce({ data: [] }); // Empty vehicle list

      const status = await api.getVehicleStatus('VIN123');

      expect(status.available).toBe(false);
      expect(status.error).toBe('No status data available for this vehicle');
    });

    test('should refresh status when requested', async () => {
      // Mock CSRF token refresh
      mockSession.get.mockResolvedValueOnce({ data: { token: 'csrf123' } });

      // Mock refresh endpoint
      mockSession.post.mockResolvedValueOnce({ data: { success: true } });

      // Mock VHR data
      mockSession.get.mockResolvedValueOnce({
        data: {
          available: true,
          battery: 90,
          locked: false,
        },
      });

      const status = await api.getVehicleStatus('VIN123', true);

      expect(mockSession.post).toHaveBeenCalledWith(
        'https://www.mopar.com/moparsvc/connect/refresh',
        expect.any(String),
        expect.any(Object)
      );
      expect(status.available).toBe(true);
      expect(status.batteryLevel).toBe(90);
    });
  });

  describe('parseVHRData', () => {
    test('should parse complete VHR data', () => {
      const vhrData = {
        doors: {
          frontLeft: 'CLOSED',
          frontRight: 'OPEN',
          rearLeft: 'CLOSED',
          rearRight: 'CLOSED',
          trunk: 'OPEN',
        },
        locked: true,
        engine: 'RUNNING',
        battery: { level: 75 },
        odometer: 25000,
        fuel: { percent: 50 },
      };

      const result = api.parseVHRData(vhrData);

      expect(result.doorStatus.frontLeft).toBe('CLOSED');
      expect(result.doorStatus.frontRight).toBe('OPEN');
      expect(result.doorStatus.trunk).toBe('OPEN');
      expect(result.lockStatus).toBe('LOCKED');
      expect(result.engineRunning).toBe(true);
      expect(result.batteryLevel).toBe(75);
      expect(result.odometer).toBe(25000);
      expect(result.fuelLevel).toBe(50);
    });

    test('should handle alternative door field names', () => {
      const vhrData = {
        doors: {
          driverFront: 'OPEN',
          passengerFront: 'CLOSED',
          driverRear: 'OPEN',
          passengerRear: 'CLOSED',
          liftgate: 'CLOSED',
        },
      };

      const result = api.parseVHRData(vhrData);

      expect(result.doorStatus.frontLeft).toBe('OPEN');
      expect(result.doorStatus.frontRight).toBe('CLOSED');
      expect(result.doorStatus.rearLeft).toBe('OPEN');
      expect(result.doorStatus.trunk).toBe('CLOSED');
    });

    test('should handle numeric battery level', () => {
      const vhrData = {
        battery: 90,
      };

      const result = api.parseVHRData(vhrData);

      expect(result.batteryLevel).toBe(90);
    });

    test('should handle numeric fuel level', () => {
      const vhrData = {
        fuel: 65,
      };

      const result = api.parseVHRData(vhrData);

      expect(result.fuelLevel).toBe(65);
    });
  });

  describe('parseDoorStatus', () => {
    test('should parse door status from vehicle', () => {
      const vehicle = {
        doors: {
          frontLeft: 'OPEN',
          frontRight: 'CLOSED',
          rearLeft: 'OPEN',
          rearRight: 'OPEN',
          trunk: 'CLOSED',
        },
      };

      const result = api.parseDoorStatus(vehicle);

      expect(result.frontLeft).toBe('OPEN');
      expect(result.frontRight).toBe('CLOSED');
      expect(result.rearLeft).toBe('OPEN');
      expect(result.rearRight).toBe('OPEN');
      expect(result.trunk).toBe('CLOSED');
    });

    test('should return all closed when no door data', () => {
      const vehicle = {};

      const result = api.parseDoorStatus(vehicle);

      expect(result.frontLeft).toBe('CLOSED');
      expect(result.frontRight).toBe('CLOSED');
      expect(result.rearLeft).toBe('CLOSED');
      expect(result.rearRight).toBe('CLOSED');
      expect(result.trunk).toBe('CLOSED');
    });
  });

  describe('parseBatteryLevel', () => {
    test('should return battery level from vehicle', () => {
      const vehicle = {
        battery: { level: 80 },
      };

      const result = api.parseBatteryLevel(vehicle);

      expect(result).toBe(80);
    });

    test('should handle numeric battery value', () => {
      const vehicle = {
        battery: 95,
      };

      const result = api.parseBatteryLevel(vehicle);

      expect(result).toBe(95);
    });

    test('should default to 100 when no battery data', () => {
      const vehicle = {};

      const result = api.parseBatteryLevel(vehicle);

      expect(result).toBe(100);
    });
  });

  describe('Debug Helper', () => {
    test('should log debug messages when debug mode enabled', () => {
      const debugApi = new MoparAPI({ test: 'cookie' }, mockLog, true);

      debugApi.debug('Test debug message');

      expect(mockLog).toHaveBeenCalledWith('[DEBUG] Test debug message');
    });

    test('should not log debug messages when debug mode disabled', () => {
      api.debug('Test debug message');

      expect(mockLog).not.toHaveBeenCalledWith(expect.stringContaining('[DEBUG]'));
    });
  });

  describe('Cookie Management', () => {
    test('should set cookies with proper domain', () => {
      const cookies = {
        glt_123: 'token_value',
        session_abc: 'session_value',
      };

      new MoparAPI(cookies, mockLog);

      expect(mockCookieJar.setCookieSync).toHaveBeenCalledWith(
        expect.stringContaining('Domain=.mopar.com'),
        'https://www.mopar.com',
        expect.any(Object)
      );
    });

    test('should mark glt_ cookies as HttpOnly', () => {
      const cookies = {
        glt_test: 'secure_token',
      };

      new MoparAPI(cookies, mockLog);

      expect(mockCookieJar.setCookieSync).toHaveBeenCalledWith(
        expect.stringContaining('HttpOnly'),
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      mockSession.get.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(api.getProfile()).rejects.toThrow('ENOTFOUND');
    });

    test('should handle API errors with status codes', async () => {
      const error = new Error('Request failed');
      error.response = { status: 403 };
      mockSession.post.mockRejectedValue(error);

      api.csrfToken = 'test';
      api.csrfTokenTimestamp = Date.now();

      await expect(api.sendCommand('VIN123', 'LOCK', '1234')).rejects.toThrow();
    });
  });
});
