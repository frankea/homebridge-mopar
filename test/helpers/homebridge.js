const createMockHomebridgeEnvironment = () => {
  const Service = class MockService {};
  Service.AccessoryInformation = { UUID: 'info-uuid' };
  Service.LockMechanism = { UUID: 'lock-uuid' };
  Service.Switch = { UUID: 'switch-uuid' };
  Service.Battery = { UUID: 'battery-uuid' };
  Service.ContactSensor = { UUID: 'contact-uuid' };

  const Characteristic = class MockCharacteristic {};
  Characteristic.LockCurrentState = { UNKNOWN: 3, SECURED: 1, UNSECURED: 0 };
  Characteristic.LockTargetState = { SECURED: 1, UNSECURED: 0 };
  Characteristic.ContactSensorState = { CONTACT_DETECTED: 0, CONTACT_NOT_DETECTED: 1 };
  Characteristic.BatteryLevel = {};
  Characteristic.StatusLowBattery = { BATTERY_LEVEL_LOW: 1, BATTERY_LEVEL_NORMAL: 0 };
  Characteristic.ChargingState = { CHARGING: 1, NOT_CHARGING: 0 };
  Characteristic.On = {};
  Characteristic.ConfiguredName = {};

  const mockHomebridge = {
    hap: {
      Service,
      Characteristic,
      uuid: {
        generate: jest.fn((str) => `uuid-${str}`),
      },
    },
    platformAccessory: class MockAccessory {
      constructor(name, uuid) {
        this.UUID = uuid;
        this.displayName = name;
        this.context = {};
        this.services = [{ UUID: Service.AccessoryInformation.UUID }];
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

  const platformModule = require('../../src/platform');
  platformModule(mockHomebridge);

  const registrationCall = mockHomebridge.registerPlatform.mock.calls[0];
  const MoparPlatform = registrationCall[2];

  return {
    mockHomebridge,
    MoparPlatform,
    Service,
    Characteristic,
  };
};

module.exports = {
  createMockHomebridgeEnvironment,
};
