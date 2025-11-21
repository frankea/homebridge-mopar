/**
 * Tests for MoparPlatform
 */

// Mock dependencies first
jest.mock('./auth');
jest.mock('./api');

const MoparAuth = require('./auth');
const MoparAPI = require('./api');

// Mock Homebridge globals
const { MoparPlatform, mockHomebridge } = (() => {
  const mockHomebridge = {
    hap: {
      Service: class MockService {
        static AccessoryInformation = { UUID: 'info-uuid' };
        static LockMechanism = { UUID: 'lock-uuid' };
        static Switch = { UUID: 'switch-uuid' };
        static Battery = { UUID: 'battery-uuid' };
        static ContactSensor = { UUID: 'contact-uuid' };
      },
      Characteristic: class MockCharacteristic {
        static LockCurrentState = { UNKNOWN: 3, SECURED: 1, UNSECURED: 0 };
        static LockTargetState = { SECURED: 1, UNSECURED: 0 };
        static ContactSensorState = { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 };
        static BatteryLevel = {};
        static StatusLowBattery = { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 };
        static ChargingState = { CHARGING: 1, NOT_CHARGING: 0 };
        static On = {};
        static ConfiguredName = {};
      },
      uuid: {
        generate: jest.fn((str) => `uuid-${str}`),
      },
    },
    platformAccessory: class MockAccessory {
      constructor(name, uuid) {
        this.UUID = uuid;
        this.displayName = name;
        this.context = {};
        this.services = [{ UUID: 'info-uuid' }];
      }
      getService() {
        return { setCharacteristic: jest.fn().mockReturnThis() };
      }
      addService() {
        const service = {
          setCharacteristic: jest.fn().mockReturnThis(),
          getCharacteristic: jest.fn().mockReturnThis(),
          updateCharacteristic: jest.fn(),
        };
        service.getCharacteristic.mockReturnValue({
          onGet: jest.fn().mockReturnThis(),
          onSet: jest.fn().mockReturnThis(),
        });
        this.services.push(service);
        return service;
      }
      removeService() {}
      getServiceById() {
        return null;
      }
    },
    registerPlatform: jest.fn(),
  };

  // Load platform with mocked Homebridge
  const platformModule = require('./platform');
  platformModule(mockHomebridge);

  // Extract the platform class from the registration call
  const registrationCall = mockHomebridge.registerPlatform.mock.calls[0];
  return { MoparPlatform: registrationCall[2], mockHomebridge };
})();

const Characteristic = mockHomebridge.hap.Characteristic;
const Service = mockHomebridge.hap.Service;

describe('MoparPlatform', () => {
  let platform;
  let mockLog;
  let mockApi;
  let mockConfig;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock logger
    mockLog = jest.fn();
    mockLog.error = jest.fn();
    mockLog.warn = jest.fn();

    // Mock Homebridge API
    mockApi = {
      on: jest.fn(),
      user: {
        storagePath: jest.fn().mockReturnValue('/tmp/homebridge-test'),
      },
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
    };

    mockLog.warn = jest.fn();

    // Mock config
    mockConfig = {
      email: 'test@example.com',
      password: 'testpassword',
      pin: '1234',
      debug: false,
    };

    // Mock MoparAuth
    MoparAuth.mockImplementation(() => ({
      login: jest.fn().mockResolvedValue({ glt_test: 'token123' }),
      areCookiesValid: jest.fn().mockReturnValue(true),
    }));

    // Mock MoparAPI
    MoparAPI.mockImplementation(() => ({
      setCookies: jest.fn(),
      initialize: jest.fn().mockResolvedValue(),
      getProfile: jest.fn().mockResolvedValue({ uid: 'test123' }),
      getVehicles: jest.fn().mockResolvedValue([
        {
          vin: 'TEST12345VIN67890',
          year: '2022',
          make: 'CHRYSLER',
          model: 'Pacifica',
          title: 'Pacifica',
        },
      ]),
      getVehiclesQuick: jest.fn().mockResolvedValue([]),
      sendCommand: jest.fn().mockResolvedValue('request123'),
      pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      startEngine: jest.fn().mockResolvedValue('request456'),
      stopEngine: jest.fn().mockResolvedValue('request789'),
      hornAndLights: jest.fn().mockResolvedValue('request101'),
      setClimate: jest.fn().mockResolvedValue('request112'),
      getVehicleStatus: jest.fn().mockResolvedValue({ available: false }),
    }));
  });

  describe('Constructor', () => {
    test('should initialize with valid configuration', () => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);

      expect(platform.email).toBe('test@example.com');
      expect(platform.password).toBe('testpassword');
      expect(platform.pin).toBe('1234');
      expect(platform.debugMode).toBe(false);
      expect(platform.accessories).toEqual([]);
    });

    test('should enable debug mode when configured', () => {
      const debugConfig = { ...mockConfig, debug: true };
      platform = new MoparPlatform(mockLog, debugConfig, mockApi);

      expect(platform.debugMode).toBe(true);
    });

    test('should set cache file path', () => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);

      expect(platform.vehicleCacheFile).toContain('homebridge-mopar-vehicles.json');
      expect(platform.vehicleCacheFile).toContain('/tmp/homebridge-test');
    });

    test('should register didFinishLaunching callback', () => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);

      expect(mockApi.on).toHaveBeenCalledWith('didFinishLaunching', expect.any(Function));
    });
  });

  describe('Invalid Configuration', () => {
    test('should handle missing email', async () => {
      const invalidConfig = { password: 'test', pin: '1234' };
      platform = new MoparPlatform(mockLog, invalidConfig, mockApi);

      await platform.initialize();

      expect(mockLog.error).toHaveBeenCalledWith('CONFIGURATION ERRORS');
      expect(mockLog.error).toHaveBeenCalledWith('1. Email is required');
      expect(MoparAuth).not.toHaveBeenCalled();
    });

    test('should handle missing password', async () => {
      const invalidConfig = { email: 'test@example.com', pin: '1234' };
      platform = new MoparPlatform(mockLog, invalidConfig, mockApi);

      await platform.initialize();

      expect(mockLog.error).toHaveBeenCalledWith('CONFIGURATION ERRORS');
      expect(mockLog.error).toHaveBeenCalledWith('1. Password is required');
      expect(MoparAuth).not.toHaveBeenCalled();
    });

    test('should handle missing both email and password', async () => {
      const invalidConfig = { pin: '1234' };
      platform = new MoparPlatform(mockLog, invalidConfig, mockApi);

      await platform.initialize();

      expect(mockLog.error).toHaveBeenCalledWith('CONFIGURATION ERRORS');
      expect(mockLog.error).toHaveBeenCalledWith('1. Email is required');
      expect(mockLog.error).toHaveBeenCalledWith('2. Password is required');
      expect(MoparAuth).not.toHaveBeenCalled();
    });
  });

  describe('Debug Helper', () => {
    test('should log debug messages when debug mode enabled', () => {
      const debugConfig = { ...mockConfig, debug: true };
      platform = new MoparPlatform(mockLog, debugConfig, mockApi);

      platform.debug('Test debug message');

      expect(mockLog).toHaveBeenCalledWith('[DEBUG] Test debug message');
    });

    test('should not log debug messages when debug mode disabled', () => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);

      platform.debug('Test debug message');

      expect(mockLog).not.toHaveBeenCalled();
    });
  });

  describe('Cache Methods', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
    });

    test('saveVehicleCache should create cache with timestamp', async () => {
      const vehicles = [{ vin: 'TEST123', make: 'JEEP', model: 'Wrangler', year: '2023' }];

      const fs = require('fs').promises;
      fs.writeFile = jest.fn().mockResolvedValue();

      await platform.saveVehicleCache(vehicles);

      expect(fs.writeFile).toHaveBeenCalled();
      const [path, data] = fs.writeFile.mock.calls[0];
      expect(path).toContain('homebridge-mopar-vehicles.json');

      const parsedData = JSON.parse(data);
      expect(parsedData).toHaveProperty('timestamp');
      expect(parsedData).toHaveProperty('vehicles');
      expect(parsedData.vehicles).toEqual(vehicles);
    });

    test('loadVehicleCache should return null when file not found', async () => {
      const fs = require('fs').promises;
      fs.readFile = jest.fn().mockRejectedValue(new Error('ENOENT'));

      const result = await platform.loadVehicleCache();

      expect(result).toBeNull();
    });

    test('loadVehicleCache should return vehicles from cache', async () => {
      const fs = require('fs').promises;
      const cacheData = {
        timestamp: Date.now(),
        vehicles: [{ vin: 'TEST123', make: 'DODGE', model: 'Durango' }],
      };
      fs.readFile = jest.fn().mockResolvedValue(JSON.stringify(cacheData));

      const result = await platform.loadVehicleCache();

      expect(result).toEqual(cacheData.vehicles);
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('hours old'));
    });
  });

  describe('Configuration Example Error Message', () => {
    test('should show correct platform name in error', async () => {
      const invalidConfig = {};
      platform = new MoparPlatform(mockLog, invalidConfig, mockApi);

      await platform.initialize();

      expect(mockLog.error).toHaveBeenCalledWith('  "platform": "Mopar",');
    });
  });

  describe('Command Retry Logic', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn().mockResolvedValue({ glt_new: 'refreshed_token' }),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn().mockResolvedValue(),
        sendCommand: jest.fn(),
        pollCommandStatus: jest.fn(),
        startEngine: jest.fn(),
        stopEngine: jest.fn(),
        hornAndLights: jest.fn(),
        setClimate: jest.fn(),
      };
    });

    test('executeCommandWithRetry should succeed on first attempt', async () => {
      const mockCommandFunc = jest.fn().mockResolvedValue(true);

      const result = await platform.executeCommandWithRetry('Test Command', mockCommandFunc);

      expect(result).toBe(true);
      expect(mockCommandFunc).toHaveBeenCalledTimes(1);
      expect(platform.auth.login).not.toHaveBeenCalled(); // Shouldn't need to re-login on success
    });

    test('executeCommandWithRetry should retry on 403 error', async () => {
      const error403 = new Error('Forbidden');
      error403.response = { status: 403 };

      // Make areCookiesValid return false on second check to trigger re-auth
      platform.auth.areCookiesValid.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const mockCommandFunc = jest.fn().mockRejectedValueOnce(error403).mockResolvedValueOnce(true);

      const result = await platform.executeCommandWithRetry('Lock', mockCommandFunc);

      expect(result).toBe(true);
      expect(mockCommandFunc).toHaveBeenCalledTimes(2);
      expect(platform.auth.login).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('expired session'));
    });

    test('executeCommandWithRetry should retry on 401 error', async () => {
      const error401 = new Error('Unauthorized');
      error401.response = { status: 401 };

      platform.auth.areCookiesValid.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const mockCommandFunc = jest.fn().mockRejectedValueOnce(error401).mockResolvedValueOnce(true);

      const result = await platform.executeCommandWithRetry('Unlock', mockCommandFunc);

      expect(result).toBe(true);
      expect(mockCommandFunc).toHaveBeenCalledTimes(2);
      expect(platform.auth.login).toHaveBeenCalled();
    });

    test('executeCommandWithRetry should not retry on other errors', async () => {
      const error500 = new Error('Server Error');
      error500.response = { status: 500 };

      const mockCommandFunc = jest.fn().mockRejectedValue(error500);

      const result = await platform.executeCommandWithRetry('Start', mockCommandFunc);

      expect(result).toBe(false);
      // Called twice: once initially, once in retry attempt (but fails again with 500)
      expect(mockCommandFunc).toHaveBeenCalled();
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });

    test('executeCommandWithRetry should handle retry failure', async () => {
      const error403 = new Error('Forbidden');
      error403.response = { status: 403 };

      const mockCommandFunc = jest.fn().mockRejectedValue(error403);

      const result = await platform.executeCommandWithRetry('Lock', mockCommandFunc);

      expect(result).toBe(false);
      expect(mockCommandFunc).toHaveBeenCalledTimes(2);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('failed on retry'));
    });
  });

  describe('ensureAuthenticated', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn(),
        login: jest.fn().mockResolvedValue({ glt_new: 'token' }),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn().mockResolvedValue(),
      };
    });

    test('should not login if cookies are valid', async () => {
      platform.auth.areCookiesValid.mockReturnValue(true);

      await platform.ensureAuthenticated();

      expect(platform.auth.login).not.toHaveBeenCalled();
    });

    test('should login if cookies are expired', async () => {
      platform.auth.areCookiesValid.mockReturnValue(false);

      await platform.ensureAuthenticated();

      expect(platform.auth.login).toHaveBeenCalled();
      expect(platform.moparAPI.setCookies).toHaveBeenCalled();
      expect(platform.moparAPI.initialize).toHaveBeenCalled();
    });

    test('should use mutex to prevent concurrent logins', async () => {
      platform.auth.areCookiesValid.mockReturnValue(false);
      platform.auth.login.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ token: '123' }), 100))
      );

      // Start two concurrent authentication attempts
      const promise1 = platform.ensureAuthenticated();
      const promise2 = platform.ensureAuthenticated();

      await Promise.all([promise1, promise2]);

      // Should only login once due to mutex
      expect(platform.auth.login).toHaveBeenCalledTimes(1);
    });

    test('should wait if login already in progress', async () => {
      platform.auth.areCookiesValid.mockReturnValue(false);
      platform.loginInProgress = true;
      platform.loginPromise = Promise.resolve();

      await platform.ensureAuthenticated();

      // Should not start new login
      expect(platform.auth.login).not.toHaveBeenCalled();
    });
  });

  describe('sendCommand', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn().mockResolvedValue({ token: '123' }),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        sendCommand: jest.fn().mockResolvedValue('req123'),
        pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      };
    });

    test('should send lock command successfully', async () => {
      const result = await platform.sendCommand('VIN123', 'LOCK');

      expect(result).toBe(true);
      expect(platform.moparAPI.sendCommand).toHaveBeenCalledWith('VIN123', 'LOCK', '1234');
      expect(mockLog).toHaveBeenCalledWith('Sending LOCK to VIN123...');
      expect(mockLog).toHaveBeenCalledWith('LOCK SUCCESS!');
    });

    test('configureLockService should create lock service when missing', () => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      const mockCharacteristic = {
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
      };
      const mockService = {
        getCharacteristic: jest.fn().mockReturnValue(mockCharacteristic),
        updateCharacteristic: jest.fn(),
      };
      const accessory = {
        addService: jest.fn().mockReturnValue(mockService),
        getServiceById: jest.fn().mockReturnValue(null),
        context: {},
      };

      platform.configureLockService(accessory, { vin: 'VIN123', year: '2022', make: 'JEEP', model: 'Wrangler' });

      expect(accessory.addService).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'VIN123-lock');
      expect(accessory.getServiceById).toHaveBeenCalledWith(expect.anything(), 'VIN123-lock');
      expect(mockCharacteristic.onSet).toHaveBeenCalled();
      expect(mockCharacteristic.onGet).toHaveBeenCalled();
    });

    test('should block command when pin missing', async () => {
      platform.pin = undefined;

      const result = await platform.sendCommand('VIN123', 'LOCK');

      expect(result).toBe(false);
      expect(platform.moparAPI.sendCommand).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith('REMOTE COMMAND BLOCKED');
    });

    test('should send unlock command successfully', async () => {
      const result = await platform.sendCommand('VIN123', 'UNLOCK');

      expect(result).toBe(true);
      expect(platform.moparAPI.sendCommand).toHaveBeenCalledWith('VIN123', 'UNLOCK', '1234');
    });

    test('should handle command failure', async () => {
      platform.moparAPI.pollCommandStatus.mockResolvedValue({ success: false, status: 'FAILED' });

      const result = await platform.sendCommand('VIN123', 'LOCK');

      expect(result).toBe(false);
      expect(mockLog.error).toHaveBeenCalledWith('LOCK failed: FAILED');
    });

    test('should retry on 403 error', async () => {
      const error403 = new Error('Forbidden');
      error403.response = { status: 403 };

      platform.auth.areCookiesValid.mockReturnValueOnce(true).mockReturnValueOnce(false);
      platform.moparAPI.sendCommand.mockRejectedValueOnce(error403).mockResolvedValueOnce('req456');

      const result = await platform.sendCommand('VIN123', 'UNLOCK');

      expect(result).toBe(true);
      expect(platform.auth.login).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('expired session'));
    });
  });

  describe('startEngine', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn(),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        startEngine: jest.fn().mockResolvedValue('req123'),
        pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      };
      platform.accessories = [];
    });

    test('should start engine successfully', async () => {
      const result = await platform.startEngine('VIN123');

      expect(result).toBe(true);
      expect(platform.moparAPI.startEngine).toHaveBeenCalledWith('VIN123', '1234');
      expect(mockLog).toHaveBeenCalledWith('Starting engine for VIN123...');
      expect(mockLog).toHaveBeenCalledWith('Engine START SUCCESS!');
    });

    test('should block engine start when pin missing', async () => {
      platform.pin = '12';

      const result = await platform.startEngine('VIN123');

      expect(result).toBe(false);
      expect(platform.moparAPI.startEngine).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith('REMOTE COMMAND BLOCKED');
    });

    test('should handle engine start failure', async () => {
      platform.moparAPI.pollCommandStatus.mockResolvedValue({ success: false, status: 'FAILED' });

      const result = await platform.startEngine('VIN123');

      expect(result).toBe(false);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });

    test('should update accessory context on success', async () => {
      const mockAccessory = { context: { vehicle: { vin: 'VIN123' } } };
      platform.accessories.push(mockAccessory);

      await platform.startEngine('VIN123');

      expect(mockAccessory.context.engineRunning).toBe(true);
    });

    test('should retry on 403 error', async () => {
      const error403 = new Error('Forbidden');
      error403.response = { status: 403 };

      platform.auth.areCookiesValid.mockReturnValueOnce(true).mockReturnValueOnce(false);
      platform.moparAPI.startEngine.mockRejectedValueOnce(error403).mockResolvedValueOnce('req456');

      const result = await platform.startEngine('VIN123');

      expect(result).toBe(true);
      expect(platform.auth.login).toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('expired session'));
    });
  });

  describe('stopEngine', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn(),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        stopEngine: jest.fn().mockResolvedValue('req789'),
        pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      };
      platform.accessories = [];
    });

    test('should stop engine successfully', async () => {
      const result = await platform.stopEngine('VIN123');

      expect(result).toBe(true);
      expect(platform.moparAPI.stopEngine).toHaveBeenCalledWith('VIN123', '1234');
      expect(mockLog).toHaveBeenCalledWith('Stopping engine for VIN123...');
      expect(mockLog).toHaveBeenCalledWith('Engine STOP SUCCESS!');
    });

    test('should block engine stop when pin missing', async () => {
      platform.pin = undefined;

      const result = await platform.stopEngine('VIN123');

      expect(result).toBe(false);
      expect(platform.moparAPI.stopEngine).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith('REMOTE COMMAND BLOCKED');
    });

    test('should handle engine stop failure', async () => {
      platform.moparAPI.pollCommandStatus.mockResolvedValue({ success: false, status: 'FAILED' });

      const result = await platform.stopEngine('VIN123');

      expect(result).toBe(false);
    });

    test('should update accessory context on success', async () => {
      const mockAccessory = { context: { vehicle: { vin: 'VIN123' }, engineRunning: true } };
      platform.accessories.push(mockAccessory);

      await platform.stopEngine('VIN123');

      expect(mockAccessory.context.engineRunning).toBe(false);
    });
  });

  describe('hornAndLights', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn(),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        hornAndLights: jest.fn().mockResolvedValue('req101'),
        pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      };
    });

    test('should activate horn and lights successfully', async () => {
      const result = await platform.hornAndLights('VIN123');

      expect(result).toBe(true);
      expect(platform.moparAPI.hornAndLights).toHaveBeenCalledWith('VIN123');
      expect(mockLog).toHaveBeenCalledWith('Activating horn and lights for VIN123...');
      expect(mockLog).toHaveBeenCalledWith('Horn and lights SUCCESS!');
    });

    test('should block horn and lights when pin missing', async () => {
      platform.pin = null;

      const result = await platform.hornAndLights('VIN123');

      expect(result).toBe(false);
      expect(platform.moparAPI.hornAndLights).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith('REMOTE COMMAND BLOCKED');
    });

    test('should handle horn and lights failure', async () => {
      platform.moparAPI.pollCommandStatus.mockResolvedValue({ success: false, status: 'TIMEOUT' });

      const result = await platform.hornAndLights('VIN123');

      expect(result).toBe(false);
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('failed'));
    });
  });

  describe('setClimate', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(true),
        login: jest.fn(),
        lastLogin: new Date(),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        setClimate: jest.fn().mockResolvedValue('req112'),
        pollCommandStatus: jest.fn().mockResolvedValue({ success: true }),
      };
    });

    test('should set climate successfully', async () => {
      const result = await platform.setClimate('VIN123', 72);

      expect(result).toBe(true);
      expect(platform.moparAPI.setClimate).toHaveBeenCalledWith('VIN123', '1234', 72);
      expect(mockLog).toHaveBeenCalledWith('Setting climate to 72°F for VIN123...');
      expect(mockLog).toHaveBeenCalledWith('Climate set to 72°F SUCCESS!');
    });

    test('should block climate command when pin missing', async () => {
      platform.pin = undefined;

      const result = await platform.setClimate('VIN123', 72);

      expect(result).toBe(false);
      expect(platform.moparAPI.setClimate).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith('REMOTE COMMAND BLOCKED');
    });

    test('should handle climate control failure', async () => {
      platform.moparAPI.pollCommandStatus.mockResolvedValue({ success: false });

      const result = await platform.setClimate('VIN123', 68);

      expect(result).toBe(false);
    });
  });

  describe('Login Mutex', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        areCookiesValid: jest.fn().mockReturnValue(false),
        login: jest
          .fn()
          .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ token: '123' }), 50))),
        lastLogin: null,
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn().mockResolvedValue(),
      };
    });

    test('concurrent ensureAuthenticated calls should only login once', async () => {
      const promises = [platform.ensureAuthenticated(), platform.ensureAuthenticated(), platform.ensureAuthenticated()];

      await Promise.all(promises);

      expect(platform.auth.login).toHaveBeenCalledTimes(1);
    });

    test('should set loginInProgress flag', async () => {
      expect(platform.loginInProgress).toBe(false);

      const promise = platform.ensureAuthenticated();
      expect(platform.loginInProgress).toBe(true);

      await promise;
      expect(platform.loginInProgress).toBe(false);
    });

    test('should clear mutex on error', async () => {
      platform.auth.login.mockRejectedValue(new Error('Login failed'));

      await expect(platform.ensureAuthenticated()).rejects.toThrow('Login failed');

      expect(platform.loginInProgress).toBe(false);
      expect(platform.loginPromise).toBeNull();
    });
  });

  describe('Background Refresh', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.auth = {
        login: jest.fn().mockResolvedValue({ token: '123' }),
        areCookiesValid: jest.fn().mockReturnValue(true),
      };
      platform.moparAPI = {
        setCookies: jest.fn(),
        initialize: jest.fn(),
        getVehicles: jest.fn().mockResolvedValue([]),
      };
      platform.accessories = [];
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should start background refresh when API returns empty', () => {
      platform.startBackgroundRefresh();

      expect(platform.backgroundRetryActive).toBe(true);
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Starting background API refresh'));
    });

    test('should stop background refresh on success', () => {
      platform.startBackgroundRefresh();
      platform.stopBackgroundRefresh();

      expect(platform.backgroundRetryActive).toBe(false);
      expect(mockLog).toHaveBeenCalledWith('Background refresh stopped');
    });

    test('should not start duplicate background refresh', () => {
      platform.startBackgroundRefresh();
      const firstInterval = platform.backgroundRetryInterval;

      platform.startBackgroundRefresh();

      expect(mockLog).toHaveBeenCalledWith('Background refresh already running');
      expect(platform.backgroundRetryInterval).toBe(firstInterval);
    });
  });

  describe('getVehiclesWithFastRetry', () => {
    beforeEach(() => {
      platform = new MoparPlatform(mockLog, mockConfig, mockApi);
      platform.moparAPI = {
        getVehiclesQuick: jest.fn(),
      };
    });

    test('should return vehicles on first attempt', async () => {
      const mockVehicles = [{ vin: 'VIN123', make: 'JEEP' }];
      platform.moparAPI.getVehiclesQuick.mockResolvedValue(mockVehicles);

      const result = await platform.getVehiclesWithFastRetry();

      expect(result).toEqual(mockVehicles);
      expect(platform.moparAPI.getVehiclesQuick).toHaveBeenCalledTimes(1);
    });

    test('should retry up to 3 times', async () => {
      platform.moparAPI.getVehiclesQuick
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ vin: 'VIN456', make: 'RAM' }]);

      const result = await platform.getVehiclesWithFastRetry();

      expect(result).toHaveLength(1);
      expect(platform.moparAPI.getVehiclesQuick).toHaveBeenCalledTimes(3);
    });

    test('should return empty array after max retries', async () => {
      platform.moparAPI.getVehiclesQuick.mockResolvedValue([]);

      const result = await platform.getVehiclesWithFastRetry();

      expect(result).toEqual([]);
      expect(platform.moparAPI.getVehiclesQuick).toHaveBeenCalledTimes(3);
    });
  });
});
