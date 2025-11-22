/**
 * Homebridge Mopar Plugin
 *
 * Supports all Mopar vehicles (Chrysler, Dodge, Jeep, Ram, Fiat, Alfa Romeo)
 * Uses automated login with Puppeteer for reliable authentication
 */

const fs = require('fs').promises;
const path = require('path');
const MoparAuth = require('./auth');
const MoparAPI = require('./api');
const ConfigValidator = require('./config-validator');
const RateLimiter = require('./rate-limiter');

const PLATFORM_NAME = 'Mopar';
const PLUGIN_NAME = 'homebridge-mopar';

let Service, Characteristic, Accessory, UUIDGen;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.platformAccessory;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MoparPlatform);
};

class MoparPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    // Configuration
    this.email = config.email;
    this.password = config.password;
    this.pin = config.pin;
    this.debugMode = config.debug || false;

    // Authentication and API clients
    this.auth = null;
    this.moparAPI = null;

    // Rate limiter for API protection
    this.rateLimiter = new RateLimiter();

    // Login mutex to prevent concurrent authentication attempts
    this.loginInProgress = false;
    this.loginPromise = null;

    // Cache file path in Homebridge's persist directory
    this.cacheDir = api?.user?.storagePath() || '/var/lib/homebridge';
    this.vehicleCacheFile = path.join(this.cacheDir, 'homebridge-mopar-vehicles.json');

    // Background retry state
    this.backgroundRetryActive = false;
    this.backgroundRetryInterval = null;
    this.backgroundRetryCount = 0;

    if (api) {
      api.on('didFinishLaunching', async () => {
        this.log('Mopar plugin finished launching');
        if (this.debugMode) {
          this.log('Debug logging enabled');
        }
        await this.initialize();
      });
    }
  }

  // Debug logging helper
  debug(message) {
    if (this.debugMode) {
      this.log(`[DEBUG] ${message}`);
    }
  }

  hasValidPin() {
    return typeof this.pin === 'string' && /^\d{4}$/.test(this.pin);
  }

  ensurePinAvailable(commandName) {
    if (this.hasValidPin()) {
      return true;
    }

    this.log.warn('========================================');
    this.log.warn('REMOTE COMMAND BLOCKED');
    this.log.warn('========================================');
    this.log.warn(`${commandName} requires a valid 4-digit vehicle PIN.`);
    this.log.warn('Read-only sensors (lock status, doors, battery) will continue to update.');
    this.log.warn('Please set the "pin" field in your Homebridge Mopar configuration and restart.');
    return false;
  }

  async initialize() {
    try {
      // Validate configuration with comprehensive validator
      const validation = ConfigValidator.validate(this.config);

      if (!validation.valid) {
        ConfigValidator.logErrors(validation.errors, this.log);
        this.log.error('');
        this.log.error('Example configuration:');
        this.log.error('{');
        this.log.error('  "platform": "Mopar",');
        this.log.error('  "name": "Mopar",');
        this.log.error('  "email": "your-email@example.com",');
        this.log.error('  "password": "your-password",');
        this.log.error('  "pin": "1234"');
        this.log.error('}');
        return;
      }

      this.log('Authenticating with Mopar.com...');

      // Initialize authentication
      this.auth = new MoparAuth(this.email, this.password, this.log.bind(this), this.debugMode);

      // Login and get cookies
      const cookies = await this.auth.login();

      this.log('Authentication successful!');

      // Debug: log cookie names before passing to API
      const cookieNames = Object.keys(cookies);
      this.debug(`Passing ${cookieNames.length} cookies to API`);
      const gltCookies = cookieNames.filter((name) => name.startsWith('glt_'));
      this.debug(`glt_ cookies found: ${gltCookies.join(', ')}`);

      // Initialize API client with cookies
      this.moparAPI = new MoparAPI(cookies, this.log.bind(this), this.debugMode);

      // Initialize API session
      this.log('Initializing API session...');
      await this.moparAPI.initialize();

      // Discover vehicles
      await this.discoverVehicles();

      // Schedule cookie refresh (every 20 hours)
      this.scheduleCookieRefresh();
    } catch (error) {
      // User-friendly error messages
      if (error.message.includes('Cannot reach Mopar.com') || error.code === 'ENOTFOUND') {
        this.log.error('========================================');
        this.log.error('CANNOT REACH MOPAR.COM');
        this.log.error('========================================');
        this.log.error('Please check your internet connection');
        this.log.error('Verify you can access https://www.mopar.com in your browser');
      } else if (error.message.includes('Login failed') || error.message.includes('credentials')) {
        this.log.error('========================================');
        this.log.error('LOGIN FAILED');
        this.log.error('========================================');
        this.log.error('Please verify your Mopar.com credentials in config.json:');
        this.log.error('- Email address must be correct');
        this.log.error('- Password must match your Mopar.com account');
        this.log.error('- Test login at https://www.mopar.com/en-us/sign-in.html');
      } else if (error.message.includes('Profile request failed') || error.message.includes('Unauthorized')) {
        this.log.error('========================================');
        this.log.error('SESSION ERROR');
        this.log.error('========================================');
        this.log.error('Mopar API rejected the session');
        this.log.error('This is usually temporary - the plugin will retry automatically');
        this.log.error('If this persists, restart Homebridge');
      } else {
        this.log.error('========================================');
        this.log.error('INITIALIZATION FAILED');
        this.log.error('========================================');
        this.log.error(`Error: ${error.message}`);
        this.log.error('Please check your credentials and restart Homebridge');
        this.log.error('Enable debug mode in config for more details');
      }

      this.debug(`Full error: ${error.stack}`);
    }
  }

  async discoverVehicles() {
    try {
      this.log('Discovering vehicles...');

      // Check for cached vehicles first for faster startup
      const cachedVehicles = await this.loadVehicleCache();
      const hasCache = cachedVehicles && cachedVehicles.length > 0;

      // Try API with reduced retries for faster startup
      const vehicles = await this.getVehiclesWithFastRetry();

      if (vehicles.length === 0) {
        if (hasCache) {
          this.log.warn('API returned no vehicles, using cache and starting background refresh...');
          this.log(`Using ${cachedVehicles.length} cached vehicle(s)`);

          cachedVehicles.forEach((vehicle) => {
            this.addVehicleAccessory(vehicle);
          });

          // Start background retry to refresh when API becomes available
          this.startBackgroundRefresh();
          return;
        } else {
          this.log.warn('No vehicles from API and no cache available');
          return;
        }
      }

      // Success! Stop any background refresh and save to cache
      this.stopBackgroundRefresh();
      this.log(`Found ${vehicles.length} vehicle(s)`);
      await this.saveVehicleCache(vehicles);

      vehicles.forEach((vehicle) => {
        this.addVehicleAccessory(vehicle);
      });
    } catch (error) {
      // Use API's friendly error logging if available
      if (this.moparAPI && this.moparAPI.logFriendlyError) {
        this.moparAPI.logFriendlyError('Vehicle discovery', error);
      } else {
        this.log.error('Failed to discover vehicles:', error.message);
      }

      // Try cache as last resort
      const cachedVehicles = await this.loadVehicleCache();
      if (cachedVehicles && cachedVehicles.length > 0) {
        this.log(`Using ${cachedVehicles.length} cached vehicle(s) after error`);
        cachedVehicles.forEach((vehicle) => {
          this.addVehicleAccessory(vehicle);
        });

        // Start background retry
        this.startBackgroundRefresh();
      }
    }
  }

  async getVehiclesWithFastRetry() {
    // Faster retry logic for startup - try 3 times with shorter delays
    const maxAttempts = 3;
    const retryDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        this.debug(`Quick retry ${attempt}/${maxAttempts}...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }

      try {
        // Use quick method without built-in retries for faster startup
        const vehicles = await this.moparAPI.getVehiclesQuick();
        if (vehicles.length > 0) {
          this.log(`Found ${vehicles.length} vehicle(s) on quick attempt ${attempt}`);
          return vehicles;
        }
        this.debug(`Quick attempt ${attempt}: empty response`);
      } catch (error) {
        this.debug(`Quick attempt ${attempt} failed: ${error.message}`);
      }
    }

    this.debug('Quick discovery returned no vehicles, will use cache if available');
    return [];
  }

  startBackgroundRefresh() {
    if (this.backgroundRetryActive) {
      this.log('Background refresh already running');
      return;
    }

    this.backgroundRetryActive = true;
    this.backgroundRetryCount = 0;
    this.log('Starting background API refresh (will retry for up to 1 hour)');

    const MAX_BACKGROUND_RETRIES = 12; // 12 attempts × 5 min = 1 hour

    const attemptRefresh = async () => {
      if (!this.backgroundRetryActive) return;

      this.backgroundRetryCount++;

      // Stop after max retries
      if (this.backgroundRetryCount > MAX_BACKGROUND_RETRIES) {
        this.log.warn(`Background refresh: Max retries reached (${MAX_BACKGROUND_RETRIES} attempts), giving up.`);
        this.log.warn('Vehicle data will be refreshed on next Homebridge restart or scheduled cookie refresh.');
        this.stopBackgroundRefresh();
        return;
      }

      try {
        this.log(
          `Background refresh: Attempt ${this.backgroundRetryCount}/${MAX_BACKGROUND_RETRIES} - Performing fresh login...`
        );

        // Fresh Puppeteer login to get new cookies and establish new backend session
        const cookies = await this.auth.login();
        this.moparAPI.setCookies(cookies);
        await this.moparAPI.initialize(); // Calls getProfile() internally

        const vehicles = await this.moparAPI.getVehicles();

        if (vehicles.length > 0) {
          this.log(`Background refresh: Success! Found ${vehicles.length} vehicle(s)`);
          await this.saveVehicleCache(vehicles);

          // Update existing accessories with fresh data
          vehicles.forEach((vehicle) => {
            const accessory = this.accessories.find((acc) => acc.context.vehicle.vin === vehicle.vin);
            if (accessory) {
              accessory.context.vehicle = vehicle;
              this.log(`Updated data for ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
            }
          });

          // Stop background refresh since we succeeded
          this.stopBackgroundRefresh();
        } else {
          this.log('Background refresh: API still returning empty, will retry with fresh login...');
        }
      } catch (error) {
        if (error.message.includes('Cannot reach') || error.code === 'ENOTFOUND') {
          this.log.warn('Background refresh: Cannot reach Mopar API - Check internet connection');
        } else if (error.message.includes('Login') || error.message.includes('credentials')) {
          this.log.error('Background refresh: Login failed - Check your credentials');
        } else {
          this.log.warn(`Background refresh: Failed (${error.message}), will retry with fresh login...`);
        }
        this.debug(`Background refresh error: ${error.stack}`);
      }
    };

    // Try immediately, then every 5 minutes
    attemptRefresh();
    this.backgroundRetryInterval = setInterval(attemptRefresh, 5 * 60 * 1000);
  }

  stopBackgroundRefresh() {
    if (this.backgroundRetryInterval) {
      clearInterval(this.backgroundRetryInterval);
      this.backgroundRetryInterval = null;
    }
    if (this.backgroundRetryActive) {
      this.backgroundRetryActive = false;
      this.log('Background refresh stopped');
    }
  }

  async saveVehicleCache(vehicles) {
    try {
      const cacheData = {
        timestamp: Date.now(),
        vehicles: vehicles,
      };
      await fs.writeFile(this.vehicleCacheFile, JSON.stringify(cacheData, null, 2));
      this.log('Vehicle data cached successfully');
    } catch (error) {
      this.log.warn('Failed to cache vehicle data:', error.message);
    }
  }

  async loadVehicleCache() {
    try {
      const data = await fs.readFile(this.vehicleCacheFile, 'utf8');
      const cache = JSON.parse(data);
      const ageHours = (Date.now() - cache.timestamp) / (1000 * 60 * 60);
      this.log(`Loaded cached vehicle data (${ageHours.toFixed(1)} hours old)`);
      return cache.vehicles;
    } catch (error) {
      // Cache file doesn't exist or is invalid - not an error
      return null;
    }
  }

  addVehicleAccessory(vehicle) {
    const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    const uuid = UUIDGen.generate(vehicle.vin);

    let accessory = this.accessories.find((acc) => acc.UUID === uuid);

    if (!accessory) {
      this.log(`Adding: ${name}`);
      accessory = new Accessory(name, uuid);
      accessory.context.vehicle = vehicle;

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      this.log(`Restoring: ${name}`);
      accessory.context.vehicle = vehicle;

      // Remove all services except AccessoryInformation and lock mechanism
      const servicesToRemove = accessory.services.filter(
        (s) => s.UUID !== Service.AccessoryInformation.UUID && s.UUID !== Service.LockMechanism.UUID
      );
      servicesToRemove.forEach((s) => {
        this.log(`Removing old service: ${s.displayName || s.subtype || 'unknown'}`);
        accessory.removeService(s);
      });

      // Initialize default states
      accessory.context.lockCurrentState = Characteristic.LockCurrentState.UNKNOWN;
      accessory.context.lockTargetState = Characteristic.LockTargetState.UNSECURED;
      accessory.context.startEngineState = false;
      accessory.context.stopEngineState = true;
    }

    accessory.context.lastLockCall = 0;
    accessory.context.lastUnlockCall = 0;

    // Set accessory information
    const infoService = accessory.getService(Service.AccessoryInformation);
    if (infoService) {
      const model = vehicle.year + ' ' + vehicle.model;
      infoService
        .setCharacteristic(Characteristic.Manufacturer, vehicle.make)
        .setCharacteristic(Characteristic.Model, model)
        .setCharacteristic(Characteristic.SerialNumber, vehicle.vin);
    }

    // Configure services
    this.log(`Configuring services for ${name}...`);
    this.configureLockService(accessory, vehicle);
    this.configureStartService(accessory, vehicle);
    this.configureBatteryService(accessory, vehicle);
    this.configureDoorSensors(accessory, vehicle);
    this.configureHornLightsSwitch(accessory, vehicle);
    this.configureClimateSwitch(accessory, vehicle);

    const serviceCount = accessory.services.length;
    this.log(`${name} configured with ${serviceCount} services`);

    // Start periodic status updates
    this.startStatusUpdates(accessory, vehicle);
  }

  configureLockService(accessory, vehicle) {
    const name = vehicle.title || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    const lockDisplayName = `${name} Lock`;
    let lockService = accessory.getServiceById(Service.LockMechanism, `${vehicle.vin}-lock`);
    if (!lockService) {
      lockService = accessory.addService(Service.LockMechanism, lockDisplayName, `${vehicle.vin}-lock`);
    }

    const updateStateCharacteristics = () => {
      const currentState = accessory.context.lockCurrentState ?? Characteristic.LockCurrentState.UNKNOWN;
      const targetState = accessory.context.lockTargetState ?? Characteristic.LockTargetState.UNSECURED;
      lockService.updateCharacteristic(Characteristic.LockCurrentState, currentState);
      lockService.updateCharacteristic(Characteristic.LockTargetState, targetState);
    };

    lockService
      .getCharacteristic(Characteristic.LockCurrentState)
      .onGet(() => accessory.context.lockCurrentState ?? Characteristic.LockCurrentState.UNKNOWN);

    lockService
      .getCharacteristic(Characteristic.LockTargetState)
      .onGet(() => accessory.context.lockTargetState ?? Characteristic.LockTargetState.UNSECURED)
      .onSet(async (targetState) => {
        const isLocking = targetState === Characteristic.LockTargetState.SECURED;
        const desiredAction = isLocking ? 'LOCK' : 'UNLOCK';

        const now = Date.now();
        const lastCallKey = isLocking ? 'lastLockCall' : 'lastUnlockCall';
        const lastCall = accessory.context[lastCallKey] || 0;
        if (now - lastCall < 10000) {
          this.log(`Ignoring duplicate ${desiredAction.toLowerCase()} command (within 10s)`);
          throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY);
        }
        accessory.context[lastCallKey] = now;

        accessory.context.lockTargetState = targetState;
        accessory.context.lockCurrentState = Characteristic.LockCurrentState.UNKNOWN;
        updateStateCharacteristics();

        const success = await this.sendCommand(vehicle.vin, desiredAction);
        if (success) {
          accessory.context.lockCurrentState = isLocking
            ? Characteristic.LockCurrentState.SECURED
            : Characteristic.LockCurrentState.UNSECURED;
          accessory.context.lockTargetState =
            accessory.context.lockCurrentState === Characteristic.LockCurrentState.SECURED
              ? Characteristic.LockTargetState.SECURED
              : Characteristic.LockTargetState.UNSECURED;
          updateStateCharacteristics();
        } else {
          accessory.context.lockTargetState = isLocking
            ? Characteristic.LockTargetState.UNSECURED
            : Characteristic.LockTargetState.SECURED;
          accessory.context.lockCurrentState = Characteristic.LockCurrentState.UNKNOWN;
          updateStateCharacteristics();
        }
      });
  }

  configureStartService(accessory, vehicle) {
    const name = vehicle.title || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

    // Start engine service
    const startDisplayName = `${name} Start Engine`;
    const startService = accessory.addService(Service.Switch, startDisplayName, vehicle.vin + '-start');

    startService
      .getCharacteristic(Characteristic.On)
      .onGet(() => {
        return accessory.context.startEngineState || false;
      })
      .onSet(async (value) => {
        if (value) {
          const now = Date.now();
          const lastCall = accessory.context.lastStartCall || 0;
          if (now - lastCall < 10000) {
            this.log('Ignoring duplicate start command (within 10s)');
            return;
          }
          accessory.context.lastStartCall = now;

          accessory.context.startEngineState = true;
          const success = await this.startEngine(vehicle.vin);
          if (success) {
            setTimeout(() => {
              accessory.context.startEngineState = false;
              startService.updateCharacteristic(Characteristic.On, false);
            }, 3000);
          } else {
            accessory.context.startEngineState = false;
            startService.updateCharacteristic(Characteristic.On, false);
          }
        }
      });

    // Stop engine service
    const stopDisplayName = `${name} Stop Engine`;
    const stopService = accessory.addService(Service.Switch, stopDisplayName, vehicle.vin + '-stop');

    stopService
      .getCharacteristic(Characteristic.On)
      .onGet(() => {
        return accessory.context.stopEngineState || false;
      })
      .onSet(async (value) => {
        if (!value) {
          const now = Date.now();
          const lastCall = accessory.context.lastStopCall || 0;
          if (now - lastCall < 10000) {
            this.log('Ignoring duplicate stop command (within 10s)');
            return;
          }
          accessory.context.lastStopCall = now;

          accessory.context.stopEngineState = false;
          const success = await this.stopEngine(vehicle.vin);
          if (success) {
            setTimeout(() => {
              accessory.context.stopEngineState = true;
              stopService.updateCharacteristic(Characteristic.On, true);
            }, 3000);
          } else {
            accessory.context.stopEngineState = true;
            stopService.updateCharacteristic(Characteristic.On, true);
          }
        }
      });
  }

  configureDoorSensors(accessory, _vehicle) {
    // Front left door
    let frontLeftDoor = accessory.getServiceById(Service.ContactSensor, 'door-fl');
    if (!frontLeftDoor) {
      frontLeftDoor = accessory.addService(Service.ContactSensor, 'Front Left Door', 'door-fl');
    }
    frontLeftDoor
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        accessory.context.doorStatus?.frontLeft === 'OPEN'
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );

    // Front right door
    let frontRightDoor = accessory.getServiceById(Service.ContactSensor, 'door-fr');
    if (!frontRightDoor) {
      frontRightDoor = accessory.addService(Service.ContactSensor, 'Front Right Door', 'door-fr');
    }
    frontRightDoor
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        accessory.context.doorStatus?.frontRight === 'OPEN'
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );

    // Rear left door
    let rearLeftDoor = accessory.getServiceById(Service.ContactSensor, 'door-rl');
    if (!rearLeftDoor) {
      rearLeftDoor = accessory.addService(Service.ContactSensor, 'Rear Left Door', 'door-rl');
    }
    rearLeftDoor
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        accessory.context.doorStatus?.rearLeft === 'OPEN'
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );

    // Rear right door
    let rearRightDoor = accessory.getServiceById(Service.ContactSensor, 'door-rr');
    if (!rearRightDoor) {
      rearRightDoor = accessory.addService(Service.ContactSensor, 'Rear Right Door', 'door-rr');
    }
    rearRightDoor
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        accessory.context.doorStatus?.rearRight === 'OPEN'
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );

    // Trunk
    let trunk = accessory.getServiceById(Service.ContactSensor, 'trunk');
    if (!trunk) {
      trunk = accessory.addService(Service.ContactSensor, 'Trunk', 'trunk');
    }
    trunk
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        accessory.context.doorStatus?.trunk === 'OPEN'
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );
  }

  configureBatteryService(accessory, vehicle) {
    const name = vehicle.title || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    const displayName = `${name} Battery`;
    const batteryService = accessory.addService(Service.Battery, displayName, vehicle.vin + '-battery');

    batteryService.getCharacteristic(Characteristic.BatteryLevel).onGet(() => accessory.context.batteryLevel || 100);

    batteryService.getCharacteristic(Characteristic.StatusLowBattery).onGet(() => {
      const level = accessory.context.batteryLevel || 100;
      return level < 20
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    });

    batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .onGet(() =>
        accessory.context.charging ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING
      );
  }

  configureHornLightsSwitch(accessory, vehicle) {
    const name = vehicle.title || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    const displayName = `${name} Horn & Lights`;
    const hornLightsService = accessory.addService(Service.Switch, displayName, vehicle.vin + '-horn');

    hornLightsService
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (value) {
          const now = Date.now();
          const lastCall = accessory.context.lastHornCall || 0;
          if (now - lastCall < 10000) {
            this.log('Ignoring duplicate horn command (within 10s)');
            hornLightsService.updateCharacteristic(Characteristic.On, false);
            return;
          }
          accessory.context.lastHornCall = now;

          await this.hornAndLights(vehicle.vin);
          // Auto turn off after 1 second
          setTimeout(() => {
            hornLightsService.updateCharacteristic(Characteristic.On, false);
          }, 1000);
        }
      });
  }

  configureClimateSwitch(accessory, vehicle) {
    const name = vehicle.title || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    const displayName = `${name} Climate`;
    const climateService = accessory.addService(Service.Switch, displayName, vehicle.vin + '-climate');

    climateService
      .getCharacteristic(Characteristic.On)
      .onGet(() => accessory.context.climateActive || false)
      .onSet(async (value) => {
        const now = Date.now();
        const lastCall = accessory.context.lastClimateCall || 0;
        if (now - lastCall < 10000) {
          this.log('Ignoring duplicate climate command (within 10s)');
          return;
        }
        accessory.context.lastClimateCall = now;

        if (value) {
          await this.setClimate(vehicle.vin, 72);
          accessory.context.climateActive = true;
        } else {
          accessory.context.climateActive = false;
        }
      });
  }

  /**
   * Execute a command with automatic retry on authentication failure
   * @param {string} commandName - Name of the command for logging
   * @param {Function} commandFunc - Async function that executes the command
   * @returns {boolean} True if command succeeded
   */
  async executeCommandWithRetry(commandName, commandFunc) {
    try {
      await this.ensureAuthenticated();
      const result = await commandFunc();
      return result;
    } catch (error) {
      // If session expired (403/401), force re-auth and retry once
      if (error.response?.status === 403 || error.response?.status === 401) {
        this.log.warn(`${commandName} failed due to expired session, re-authenticating and retrying...`);

        // Force fresh login by invalidating cached cookies
        this.auth.lastLogin = null;

        // ensureAuthenticated() will use the mutex to prevent concurrent logins
        await this.ensureAuthenticated();

        try {
          const retryResult = await commandFunc();
          this.log(`${commandName} succeeded on retry after re-authentication`);
          return retryResult;
        } catch (retryError) {
          this.logDetailedError(commandName, retryError, 'retry');
          return false;
        }
      }

      // If server error (500), session cookies may have expired - re-auth and retry
      if (error.response?.status === 500) {
        this.log.warn(
          `${commandName} failed with server error (likely session expiry), re-authenticating and retrying...`
        );
        this.logDetailedError(commandName, error);

        // Force fresh login - session cookies (JSESSIONID, etc.) likely expired
        this.auth.lastLogin = null;

        // ensureAuthenticated() will use the mutex to prevent concurrent logins
        await this.ensureAuthenticated();

        try {
          const retryResult = await commandFunc();
          this.log(`${commandName} succeeded on retry after re-authentication`);
          return retryResult;
        } catch (retryError) {
          this.log.error(`${commandName} failed on retry after server error`);
          this.logDetailedError(commandName, retryError, 'retry');
          return false;
        }
      }

      this.logDetailedError(commandName, error);
      return false;
    }
  }

  logDetailedError(commandName, error, context = null) {
    const prefix = context ? `${commandName} failed on ${context}:` : `${commandName} failed:`;

    // Log basic error message
    this.log.error(`${prefix} ${error.message}`);

    // If it's an HTTP error, log additional details
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;

      this.log.error(`  HTTP ${status} ${statusText}`);

      // Log URL if available
      if (error.config?.url) {
        this.log.error(`  URL: ${error.config.url}`);
      }

      // Log response body if available and not too large
      if (error.response.data) {
        const dataStr =
          typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);

        if (dataStr.length < 500) {
          this.log.error(`  Response: ${dataStr}`);
        } else {
          this.log.error(`  Response: ${dataStr.substring(0, 500)}... (truncated)`);
        }
      }

      // Log request body if available (useful for debugging 400 errors)
      if (error.config?.data) {
        const reqData = typeof error.config.data === 'string' ? error.config.data : JSON.stringify(error.config.data);

        if (reqData.length < 200) {
          this.debug(`  Request body: ${reqData}`);
        }
      }
    }
  }

  async sendCommand(vin, action) {
    if (!this.ensurePinAvailable(`${action} command`)) {
      return false;
    }

    // Check rate limit
    const commandType = action.toLowerCase();
    const rateLimitCheck = this.rateLimiter.canExecute(commandType, vin);

    if (!rateLimitCheck.allowed) {
      this.log.warn('========================================');
      this.log.warn('RATE LIMIT EXCEEDED');
      this.log.warn('========================================');
      this.log.warn(`${action} command blocked to protect your Mopar account`);
      this.log.warn(`Limit: ${rateLimitCheck.limit}`);
      this.log.warn(`Please wait ${rateLimitCheck.waitMinutes} minute(s) before trying again`);
      this.log.warn('This prevents Mopar from blocking your account for excessive API use');
      return false;
    }

    return this.executeCommandWithRetry(action, async () => {
      this.log(`Sending ${action} to ${vin}...`);

      const serviceRequestId = await this.moparAPI.sendCommand(vin, action, this.pin);

      this.log('Command sent, polling for status...');
      const result = await this.moparAPI.pollCommandStatus(vin, action, serviceRequestId);

      if (result.success) {
        this.log(`${action} SUCCESS!`);
        return true;
      } else {
        this.log.error(`${action} failed: ${result.status}`);
        return false;
      }
    });
  }

  async startEngine(vin) {
    if (!this.ensurePinAvailable('Remote start')) {
      return false;
    }

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.canExecute('start', vin);

    if (!rateLimitCheck.allowed) {
      this.log.warn('========================================');
      this.log.warn('RATE LIMIT EXCEEDED');
      this.log.warn('========================================');
      this.log.warn('Remote start blocked to protect your Mopar account');
      this.log.warn(`Limit: ${rateLimitCheck.limit}`);
      this.log.warn(`Please wait ${rateLimitCheck.waitMinutes} minute(s) before trying again`);
      this.log.warn('Excessive remote starts can drain battery and may trigger account restrictions');
      return false;
    }

    const accessory = this.accessories.find((acc) => acc.context.vehicle.vin === vin);

    return this.executeCommandWithRetry('Engine START', async () => {
      this.log(`Starting engine for ${vin}...`);
      const serviceRequestId = await this.moparAPI.startEngine(vin, this.pin);
      const result = await this.moparAPI.pollCommandStatus(vin, 'START', serviceRequestId);

      if (result.success) {
        this.log('Engine START SUCCESS!');
        if (accessory) {
          accessory.context.engineRunning = true;
        }
        return true;
      } else {
        this.log.error(`Engine START failed: ${result.status || 'Unknown error'}`);
        if (accessory) {
          accessory.context.engineRunning = false;
        }
        return false;
      }
    });
  }

  async stopEngine(vin) {
    if (!this.ensurePinAvailable('Remote stop')) {
      return false;
    }

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.canExecute('stop', vin);

    if (!rateLimitCheck.allowed) {
      this.log.warn(`Stop engine command rate limited - please wait ${rateLimitCheck.waitMinutes} minute(s)`);
      return false;
    }

    const accessory = this.accessories.find((acc) => acc.context.vehicle.vin === vin);

    return this.executeCommandWithRetry('Engine STOP', async () => {
      this.log(`Stopping engine for ${vin}...`);
      const serviceRequestId = await this.moparAPI.stopEngine(vin, this.pin);
      const result = await this.moparAPI.pollCommandStatus(vin, 'STOP', serviceRequestId);

      if (result.success) {
        this.log('Engine STOP SUCCESS!');
        if (accessory) {
          accessory.context.engineRunning = false;
        }
        return true;
      } else {
        this.log.error(`Engine STOP failed: ${result.status || 'Unknown error'}`);
        return false;
      }
    });
  }

  async hornAndLights(vin) {
    if (!this.ensurePinAvailable('Horn & lights')) {
      return false;
    }

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.canExecute('hornLights', vin);

    if (!rateLimitCheck.allowed) {
      this.log.warn(`Horn and lights command rate limited - please wait ${rateLimitCheck.waitMinutes} minute(s)`);
      this.log.warn(`Limit: ${rateLimitCheck.limit}`);
      return false;
    }

    return this.executeCommandWithRetry('Horn and Lights', async () => {
      this.log(`Activating horn and lights for ${vin}...`);
      const serviceRequestId = await this.moparAPI.hornAndLights(vin);
      const result = await this.moparAPI.pollCommandStatus(vin, 'HORNLIGHTS', serviceRequestId);

      if (result.success) {
        this.log('Horn and lights SUCCESS!');
        return true;
      } else {
        this.log.error(`Horn and lights failed: ${result.status || 'Unknown error'}`);
        return false;
      }
    });
  }

  async setClimate(vin, temperature) {
    if (!this.ensurePinAvailable('Climate control')) {
      return false;
    }

    // Check rate limit
    const rateLimitCheck = this.rateLimiter.canExecute('climate', vin);

    if (!rateLimitCheck.allowed) {
      this.log.warn(`Climate control command rate limited - please wait ${rateLimitCheck.waitMinutes} minute(s)`);
      this.log.warn(`Limit: ${rateLimitCheck.limit}`);
      return false;
    }

    return this.executeCommandWithRetry('Climate Control', async () => {
      this.log(`Setting climate to ${temperature}°F for ${vin}...`);
      const serviceRequestId = await this.moparAPI.setClimate(vin, this.pin, temperature);
      const result = await this.moparAPI.pollCommandStatus(vin, 'CLIMATE', serviceRequestId);

      if (result.success) {
        this.log(`Climate set to ${temperature}°F SUCCESS!`);
        return true;
      } else {
        this.log.error(`Climate failed: ${result.status || 'Unknown error'}`);
        return false;
      }
    });
  }

  startStatusUpdates(accessory, vehicle) {
    // Update vehicle status every 5 minutes
    const updateInterval = 5 * 60 * 1000;

    const updateStatus = async () => {
      try {
        await this.ensureAuthenticated();
        const status = await this.moparAPI.getVehicleStatus(vehicle.vin);

        // If status endpoint isn't available, skip updates silently
        if (!status || status.available === false) {
          return;
        }

        // Update door status
        if (status.doorStatus) {
          accessory.context.doorStatus = status.doorStatus;

          // Update contact sensors
          const frontLeftDoor = accessory.getServiceById(Service.ContactSensor, 'door-fl');
          if (frontLeftDoor) {
            frontLeftDoor.updateCharacteristic(
              Characteristic.ContactSensorState,
              status.doorStatus.frontLeft === 'OPEN'
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED
            );
          }

          const frontRightDoor = accessory.getServiceById(Service.ContactSensor, 'door-fr');
          if (frontRightDoor) {
            frontRightDoor.updateCharacteristic(
              Characteristic.ContactSensorState,
              status.doorStatus.frontRight === 'OPEN'
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED
            );
          }

          const rearLeftDoor = accessory.getServiceById(Service.ContactSensor, 'door-rl');
          if (rearLeftDoor) {
            rearLeftDoor.updateCharacteristic(
              Characteristic.ContactSensorState,
              status.doorStatus.rearLeft === 'OPEN'
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED
            );
          }

          const rearRightDoor = accessory.getServiceById(Service.ContactSensor, 'door-rr');
          if (rearRightDoor) {
            rearRightDoor.updateCharacteristic(
              Characteristic.ContactSensorState,
              status.doorStatus.rearRight === 'OPEN'
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED
            );
          }

          const trunk = accessory.getServiceById(Service.ContactSensor, 'trunk');
          if (trunk) {
            trunk.updateCharacteristic(
              Characteristic.ContactSensorState,
              status.doorStatus.trunk === 'OPEN'
                ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                : Characteristic.ContactSensorState.CONTACT_DETECTED
            );
          }
        }

        // Update battery level
        if (status.batteryLevel !== undefined) {
          accessory.context.batteryLevel = status.batteryLevel;
          const batteryService = accessory.getService(Service.Battery);
          if (batteryService) {
            batteryService.updateCharacteristic(Characteristic.BatteryLevel, status.batteryLevel);
            batteryService.updateCharacteristic(
              Characteristic.StatusLowBattery,
              status.batteryLevel < 20
                ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
                : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
            );
          }
        }

        // Update lock status
        if (status.lockStatus) {
          accessory.context.lockStatus = status.lockStatus;
          const currentState =
            status.lockStatus === 'LOCKED'
              ? Characteristic.LockCurrentState.SECURED
              : Characteristic.LockCurrentState.UNSECURED;

          const targetState =
            currentState === Characteristic.LockCurrentState.SECURED
              ? Characteristic.LockTargetState.SECURED
              : Characteristic.LockTargetState.UNSECURED;

          accessory.context.lockCurrentState = currentState;
          accessory.context.lockTargetState = targetState;

          const lockService = accessory.getServiceById(Service.LockMechanism, `${vehicle.vin}-lock`);
          if (lockService) {
            lockService.updateCharacteristic(Characteristic.LockCurrentState, currentState);
            lockService.updateCharacteristic(Characteristic.LockTargetState, targetState);
          }
        }

        // Update engine status (for informational purposes only)
        if (status.engineRunning !== undefined) {
          accessory.context.engineRunning = status.engineRunning;
        }
      } catch (error) {
        this.log.error('Failed to update vehicle status:', error.message);
      }
    };

    // Initial update
    setTimeout(() => updateStatus(), 10000); // Wait 10 seconds after startup

    // Periodic updates
    setInterval(updateStatus, updateInterval);
  }

  async ensureAuthenticated() {
    if (!this.auth.areCookiesValid()) {
      // If login is already in progress, wait for it to complete
      if (this.loginInProgress && this.loginPromise) {
        this.debug('Login already in progress, waiting...');
        await this.loginPromise;
        return;
      }

      // Start new login and set mutex
      this.loginInProgress = true;
      this.loginPromise = (async () => {
        try {
          this.log('Session expired, re-authenticating...');
          const cookies = await this.auth.login();
          this.moparAPI.setCookies(cookies);
          await this.moparAPI.initialize();
        } finally {
          this.loginInProgress = false;
          this.loginPromise = null;
        }
      })();

      await this.loginPromise;
    }
  }

  scheduleCookieRefresh() {
    // Session refresh every 50 minutes (before 1hr session expiry)
    // This prevents HTTP 500 errors from expired session cookies
    const sessionRefreshInterval = 50 * 60 * 1000; // 50 minutes in ms

    setInterval(async () => {
      try {
        this.log('Scheduled session refresh (50min)...');

        // If login is already in progress, skip this refresh
        if (this.loginInProgress && this.loginPromise) {
          this.log('Login already in progress, skipping session refresh');
          await this.loginPromise;
          return;
        }

        // Use mutex to prevent concurrent logins
        this.loginInProgress = true;
        this.loginPromise = (async () => {
          try {
            const cookies = await this.auth.login();
            this.moparAPI.setCookies(cookies);
            // Wait for cookies to settle and session to propagate on Mopar backend
            this.debug('Waiting 2 seconds for session to propagate...');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await this.moparAPI.initialize();
            this.log('Session refresh successful');
          } finally {
            this.loginInProgress = false;
            this.loginPromise = null;
          }
        })();

        await this.loginPromise;
      } catch (error) {
        if (error.message.includes('Cannot reach') || error.code === 'ENOTFOUND') {
          this.log.warn('Session refresh failed: Cannot reach Mopar.com - Will retry later');
        } else if (error.message.includes('timeout')) {
          this.log.warn('Session refresh timed out - Mopar.com may be slow, will retry later');
        } else {
          this.log.error('Session refresh failed:', error.message);
          this.log.error('Your next command will trigger a fresh login');
        }
        this.debug(`Session refresh error: ${error.stack}`);
        this.loginInProgress = false;
        this.loginPromise = null;
      }
    }, sessionRefreshInterval);

    // Cookie refresh every 20 hours (for long-term cookie validity)
    const cookieRefreshInterval = 20 * 60 * 60 * 1000; // 20 hours in ms

    setInterval(async () => {
      try {
        this.log('Scheduled cookie refresh (20hr)...');

        // If login is already in progress, skip this refresh
        if (this.loginInProgress && this.loginPromise) {
          this.log('Login already in progress, skipping cookie refresh');
          await this.loginPromise;
          return;
        }

        // Use mutex to prevent concurrent logins
        this.loginInProgress = true;
        this.loginPromise = (async () => {
          try {
            const cookies = await this.auth.login();
            this.moparAPI.setCookies(cookies);
            // Wait for cookies to settle and session to propagate on Mopar backend
            this.debug('Waiting 2 seconds for session to propagate...');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await this.moparAPI.initialize();
            this.log('Cookie refresh successful');
          } finally {
            this.loginInProgress = false;
            this.loginPromise = null;
          }
        })();

        await this.loginPromise;
      } catch (error) {
        if (error.message.includes('Cannot reach') || error.code === 'ENOTFOUND') {
          this.log.warn('Cookie refresh failed: Cannot reach Mopar.com - Will retry in 20 hours');
        } else if (error.message.includes('timeout')) {
          this.log.warn('Cookie refresh timed out - Will retry in 20 hours');
        } else {
          this.log.error('Cookie refresh failed:', error.message);
          this.log.error('Your next command will trigger a fresh login if needed');
        }
        this.debug(`Cookie refresh error: ${error.stack}`);
        this.loginInProgress = false;
        this.loginPromise = null;
      }
    }, cookieRefreshInterval);

    this.log('Scheduled automatic session refresh every 50 minutes');
    this.log('Scheduled automatic cookie refresh every 20 hours');
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }
}
