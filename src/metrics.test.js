/**
 * Tests for Metrics
 */

const Metrics = require('./metrics');

describe('Metrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new Metrics();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-10-20T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('recordCommand', () => {
    test('should record successful command', () => {
      metrics.recordCommand('lock', true, 1500);

      const summary = metrics.getSummary();
      expect(summary.commands.lock.success).toBe(1);
      expect(summary.commands.lock.failure).toBe(0);
      expect(summary.commands.lock.total).toBe(1);
    });

    test('should record failed command', () => {
      metrics.recordCommand('start', false, 2000);

      const summary = metrics.getSummary();
      expect(summary.commands.start.success).toBe(0);
      expect(summary.commands.start.failure).toBe(1);
      expect(summary.commands.start.total).toBe(1);
    });

    test('should track average duration', () => {
      metrics.recordCommand('unlock', true, 1000);
      metrics.recordCommand('unlock', true, 2000);
      metrics.recordCommand('unlock', true, 3000);

      const summary = metrics.getSummary();
      expect(summary.commands.unlock.avgDuration).toBe('2000ms');
    });

    test('should calculate success rate', () => {
      metrics.recordCommand('lock', true, 1000);
      metrics.recordCommand('lock', true, 1000);
      metrics.recordCommand('lock', false, 1000);

      const summary = metrics.getSummary();
      expect(summary.commands.lock.successRate).toBe('67%'); // 2/3
    });
  });

  describe('recordAPICall', () => {
    test('should record successful API call', () => {
      metrics.recordAPICall('/getVehicles', true);

      const summary = metrics.getSummary();
      expect(summary.apiCalls['/getVehicles'].total).toBe(1);
      expect(summary.apiCalls['/getVehicles'].errors).toBe(0);
    });

    test('should record failed API call', () => {
      metrics.recordAPICall('/sendCommand', false);

      const summary = metrics.getSummary();
      expect(summary.apiCalls['/sendCommand'].total).toBe(1);
      expect(summary.apiCalls['/sendCommand'].errors).toBe(1);
    });

    test('should calculate error rate', () => {
      metrics.recordAPICall('/test', true);
      metrics.recordAPICall('/test', true);
      metrics.recordAPICall('/test', false);

      const summary = metrics.getSummary();
      expect(summary.apiCalls['/test'].errorRate).toBe('33%'); // 1/3
    });
  });

  describe('recordError', () => {
    test('should record error occurrences', () => {
      metrics.recordError('NETWORK');
      metrics.recordError('NETWORK');
      metrics.recordError('AUTH');

      const summary = metrics.getSummary();
      expect(summary.errors.NETWORK).toBe(2);
      expect(summary.errors.AUTH).toBe(1);
    });
  });

  describe('recordSessionRefresh', () => {
    test('should track successful session refresh', () => {
      metrics.recordSessionRefresh(true);

      const summary = metrics.getSummary();
      expect(summary.sessionRefreshes.success).toBe(1);
      expect(summary.sessionRefreshes.failure).toBe(0);
    });

    test('should track failed session refresh', () => {
      metrics.recordSessionRefresh(false);

      const summary = metrics.getSummary();
      expect(summary.sessionRefreshes.success).toBe(0);
      expect(summary.sessionRefreshes.failure).toBe(1);
    });
  });

  describe('recordCookieRefresh', () => {
    test('should track successful cookie refresh', () => {
      metrics.recordCookieRefresh(true);

      const summary = metrics.getSummary();
      expect(summary.cookieRefreshes.success).toBe(1);
    });

    test('should track failed cookie refresh', () => {
      metrics.recordCookieRefresh(false);

      const summary = metrics.getSummary();
      expect(summary.cookieRefreshes.failure).toBe(1);
    });
  });

  describe('recordLogin', () => {
    test('should track successful login', () => {
      metrics.recordLogin(true);

      const summary = metrics.getSummary();
      expect(summary.logins.success).toBe(1);
    });

    test('should track failed login', () => {
      metrics.recordLogin(false);

      const summary = metrics.getSummary();
      expect(summary.logins.failure).toBe(1);
    });
  });

  describe('getSummary', () => {
    test('should include uptime', async () => {
      jest.useRealTimers(); // Use real timers for Date.now()

      const testMetrics = new Metrics();

      // Wait a small amount of real time
      await new Promise((resolve) => setTimeout(resolve, 10));

      const summary = testMetrics.getSummary();
      // Uptime should be positive
      expect(summary.uptime.milliseconds).toBeGreaterThan(0);
      expect(summary.uptime.formatted).toBeDefined();

      jest.useFakeTimers(); // Restore fake timers
    });

    test('should return empty stats when no activity', () => {
      const summary = metrics.getSummary();

      expect(summary.commands).toEqual({});
      expect(summary.apiCalls).toEqual({});
      expect(summary.errors).toEqual({});
      expect(summary.logins).toEqual({ success: 0, failure: 0 });
    });

    test('should aggregate all metrics', () => {
      metrics.recordCommand('lock', true, 1000);
      metrics.recordAPICall('/test', true);
      metrics.recordError('NETWORK');
      metrics.recordLogin(true);
      metrics.recordSessionRefresh(true);

      const summary = metrics.getSummary();

      expect(summary.commands.lock).toBeDefined();
      expect(summary.apiCalls['/test']).toBeDefined();
      expect(summary.errors.NETWORK).toBe(1);
      expect(summary.logins.success).toBe(1);
      expect(summary.sessionRefreshes.success).toBe(1);
    });
  });

  describe('formatUptime', () => {
    test('should format seconds only', () => {
      expect(metrics.formatUptime(30000)).toBe('30s');
    });

    test('should format minutes and seconds', () => {
      expect(metrics.formatUptime(90000)).toBe('1m 30s');
      expect(metrics.formatUptime(125000)).toBe('2m 5s');
    });

    test('should format hours, minutes, and seconds', () => {
      expect(metrics.formatUptime(3661000)).toBe('1h 1m 1s');
      expect(metrics.formatUptime(7200000)).toBe('2h 0m 0s');
    });
  });

  describe('logSummary', () => {
    test('should log metrics summary', () => {
      const mockLog = jest.fn();

      metrics.recordCommand('lock', true, 1000);
      metrics.recordCommand('lock', false, 1500);
      metrics.recordLogin(true);
      metrics.recordError('TIMEOUT');

      metrics.logSummary(mockLog);

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('[METRICS]'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Plugin Uptime'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Command Statistics'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('lock'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Logins'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Error Counts'));
    });

    test('should not log empty sections', () => {
      const mockLog = jest.fn();

      metrics.logSummary(mockLog);

      // Should only show uptime and banners
      const calls = mockLog.mock.calls.map((call) => call[0]);
      expect(calls.filter((c) => c.includes('Command Statistics')).length).toBe(0);
      expect(calls.filter((c) => c.includes('Logins')).length).toBe(0);
    });
  });

  describe('reset', () => {
    test('should clear all metrics', () => {
      metrics.recordCommand('lock', true, 1000);
      metrics.recordAPICall('/test', true);
      metrics.recordError('NETWORK');
      metrics.recordLogin(true);

      metrics.reset();

      const summary = metrics.getSummary();
      expect(summary.commands).toEqual({});
      expect(summary.apiCalls).toEqual({});
      expect(summary.errors).toEqual({});
      expect(summary.logins).toEqual({ success: 0, failure: 0 });
    });

    test('should reset uptime start time', async () => {
      jest.useRealTimers();

      const testMetrics = new Metrics();
      await new Promise((resolve) => setTimeout(resolve, 10));
      testMetrics.reset();

      const summary = testMetrics.getSummary();
      expect(summary.uptime.milliseconds).toBeLessThan(10); // Should be nearly zero

      jest.useFakeTimers();
    });
  });

  describe('Privacy verification', () => {
    test('should have no network calls', () => {
      const metricsCode = require('fs').readFileSync(__filename.replace('.test.js', '.js'), 'utf8');

      // Verify no fetch, axios, http, https, or net imports
      expect(metricsCode).not.toContain("require('http");
      expect(metricsCode).not.toContain("require('https");
      expect(metricsCode).not.toContain("require('axios");
      expect(metricsCode).not.toContain("require('fetch");
      expect(metricsCode).not.toContain("require('net");
      expect(metricsCode).not.toContain('require("http');
      expect(metricsCode).not.toContain('require("axios');
      expect(metricsCode).not.toContain('fetch(');

      // Verify privacy guarantee is documented
      expect(metricsCode).toContain('PRIVACY GUARANTEE');
      expect(metricsCode).toContain('NO external calls');
    });

    test('should store data locally only', () => {
      metrics.recordCommand('test', true, 100);

      // All data should be in local Map objects
      expect(metrics.commands).toBeInstanceOf(Map);
      expect(metrics.apiCalls).toBeInstanceOf(Map);
      expect(metrics.errors).toBeInstanceOf(Map);
    });
  });
});
