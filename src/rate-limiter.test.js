/**
 * Tests for RateLimiter
 */

const RateLimiter = require('./rate-limiter');

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('canExecute', () => {
    test('should allow first request', () => {
      const result = rateLimiter.canExecute('lock', 'VIN123');

      expect(result.allowed).toBe(true);
      expect(result.waitTime).toBeUndefined();
    });

    test('should allow requests within limit', () => {
      // Start command has limit of 3 per hour
      const result1 = rateLimiter.canExecute('start', 'VIN123');
      const result2 = rateLimiter.canExecute('start', 'VIN123');
      const result3 = rateLimiter.canExecute('start', 'VIN123');

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    test('should block requests exceeding limit', () => {
      // Lock command has limit of 10 per 5 minutes
      for (let i = 0; i < 10; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      const result = rateLimiter.canExecute('lock', 'VIN123');

      expect(result.allowed).toBe(false);
      expect(result.waitTime).toBeGreaterThan(0);
      expect(result.waitMinutes).toBeGreaterThan(0);
      expect(result.limit).toBe('10 per 5 minutes');
    });

    test('should allow requests after time window expires', () => {
      // Make 10 lock requests
      for (let i = 0; i < 10; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      // Next request should be blocked
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(false);

      // Advance time by 6 minutes (past the 5-minute window)
      jest.advanceTimersByTime(6 * 60 * 1000);

      // Now it should be allowed
      const result = rateLimiter.canExecute('lock', 'VIN123');
      expect(result.allowed).toBe(true);
    });

    test('should track per-vehicle limits separately', () => {
      // Make 10 lock requests for VIN123
      for (let i = 0; i < 10; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      // VIN123 should be blocked
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(false);

      // But VIN456 should still be allowed
      expect(rateLimiter.canExecute('lock', 'VIN456').allowed).toBe(true);
    });

    test('should track different commands separately', () => {
      // Max out lock commands
      for (let i = 0; i < 10; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      // Lock should be blocked
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(false);

      // But start should still be allowed
      expect(rateLimiter.canExecute('start', 'VIN123').allowed).toBe(true);
    });

    test('should allow commands with no defined limit', () => {
      const result = rateLimiter.canExecute('unknownCommand', 'VIN123');

      expect(result.allowed).toBe(true);
    });

    test('should calculate correct wait time', () => {
      // Make 3 start requests (max for 1 hour)
      rateLimiter.canExecute('start', 'VIN123');
      jest.advanceTimersByTime(1000);
      rateLimiter.canExecute('start', 'VIN123');
      jest.advanceTimersByTime(1000);
      rateLimiter.canExecute('start', 'VIN123');

      // Next request should be blocked
      const result = rateLimiter.canExecute('start', 'VIN123');

      expect(result.allowed).toBe(false);
      // Should wait until oldest request expires (about 1 hour minus 2 seconds)
      expect(result.waitTime).toBeGreaterThanOrEqual(3598000); // ~59 min 58 sec
      expect(result.waitTime).toBeLessThanOrEqual(3600000); // 1 hour
    });

    test('should evict stale requests before evaluating limits', () => {
      const vin = 'VIN123';
      const now = Date.now();

      jest.setSystemTime(new Date(now - 600001));
      rateLimiter.canExecute('lock', vin);

      jest.setSystemTime(new Date(now));
      const result = rateLimiter.canExecute('lock', vin);

      expect(result.allowed).toBe(true);
      expect(rateLimiter.requests.get(`lock_${vin}`)).toHaveLength(1);
    });

    test('should handle hornLights rate limit', () => {
      // hornLights has limit of 5 per 5 minutes
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.canExecute('hornLights', 'VIN123').allowed).toBe(true);
      }

      const result = rateLimiter.canExecute('hornLights', 'VIN123');

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe('5 per 5 minutes');
    });
  });

  describe('getUsageStats', () => {
    test('should return usage stats for command', () => {
      rateLimiter.canExecute('lock', 'VIN123');
      rateLimiter.canExecute('lock', 'VIN123');
      rateLimiter.canExecute('lock', 'VIN123');

      const stats = rateLimiter.getUsageStats('lock', 'VIN123');

      expect(stats.count).toBe(3);
      expect(stats.limit).toBe(10);
      expect(stats.window).toBe('5 minutes');
      expect(stats.remaining).toBe(7);
    });

    test('should return zero stats for unused command', () => {
      const stats = rateLimiter.getUsageStats('start', 'VIN123');

      expect(stats.count).toBe(0);
      expect(stats.limit).toBe(3);
      expect(stats.remaining).toBe(3);
    });

    test('should return null stats for undefined command', () => {
      const stats = rateLimiter.getUsageStats('unknownCommand', 'VIN123');

      expect(stats.count).toBe(0);
      expect(stats.limit).toBe(null);
      expect(stats.window).toBe(null);
    });

    test('should update stats after time passes', () => {
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      expect(rateLimiter.getUsageStats('lock', 'VIN123').count).toBe(5);

      // Advance past the 5-minute window
      jest.advanceTimersByTime(6 * 60 * 1000);

      // Old requests should be filtered out
      expect(rateLimiter.getUsageStats('lock', 'VIN123').count).toBe(0);
      expect(rateLimiter.getUsageStats('lock', 'VIN123').remaining).toBe(10);
    });
  });

  describe('formatWindow', () => {
    test('should format minutes correctly', () => {
      expect(rateLimiter.formatWindow(60000)).toBe('1 minute');
      expect(rateLimiter.formatWindow(300000)).toBe('5 minutes');
      expect(rateLimiter.formatWindow(600000)).toBe('10 minutes');
    });

    test('should format hours correctly', () => {
      expect(rateLimiter.formatWindow(3600000)).toBe('1 hour');
      expect(rateLimiter.formatWindow(7200000)).toBe('2 hours');
    });
  });

  describe('reset', () => {
    test('should reset history for specific command and VIN', () => {
      // Max out lock commands for VIN123
      for (let i = 0; i < 10; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
      }

      // Should be blocked
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(false);

      // Reset
      rateLimiter.reset('lock', 'VIN123');

      // Should now be allowed
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(true);
    });

    test('should not affect other VINs when resetting', () => {
      rateLimiter.canExecute('lock', 'VIN123');
      rateLimiter.canExecute('lock', 'VIN456');

      rateLimiter.reset('lock', 'VIN123');

      const stats123 = rateLimiter.getUsageStats('lock', 'VIN123');
      const stats456 = rateLimiter.getUsageStats('lock', 'VIN456');

      expect(stats123.count).toBe(0);
      expect(stats456.count).toBe(1);
    });
  });

  describe('resetAll', () => {
    test('should clear all rate limit history', () => {
      rateLimiter.canExecute('lock', 'VIN123');
      rateLimiter.canExecute('start', 'VIN123');
      rateLimiter.canExecute('lock', 'VIN456');

      rateLimiter.resetAll();

      expect(rateLimiter.getUsageStats('lock', 'VIN123').count).toBe(0);
      expect(rateLimiter.getUsageStats('start', 'VIN123').count).toBe(0);
      expect(rateLimiter.getUsageStats('lock', 'VIN456').count).toBe(0);
    });
  });

  describe('Integration scenarios', () => {
    test('should enforce start command limit realistically', () => {
      // Start has limit of 3 per hour
      expect(rateLimiter.canExecute('start', 'VIN123').allowed).toBe(true);

      jest.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      expect(rateLimiter.canExecute('start', 'VIN123').allowed).toBe(true);

      jest.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      expect(rateLimiter.canExecute('start', 'VIN123').allowed).toBe(true);

      // 4th request should be blocked
      const blocked = rateLimiter.canExecute('start', 'VIN123');
      expect(blocked.allowed).toBe(false);
      expect(blocked.waitMinutes).toBeGreaterThan(35); // ~40 minutes remaining
    });

    test('should allow gradual usage over time', () => {
      // Make 5 lock requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.canExecute('lock', 'VIN123');
        jest.advanceTimersByTime(30000); // 30 seconds apart
      }

      // Should still have room (limit is 10 per 5 min)
      expect(rateLimiter.canExecute('lock', 'VIN123').allowed).toBe(true);

      // Advance 3 minutes (first requests should expire)
      jest.advanceTimersByTime(3 * 60 * 1000);

      // Should have more room now
      const stats = rateLimiter.getUsageStats('lock', 'VIN123');
      expect(stats.count).toBeLessThan(5); // Some requests expired
    });
  });
});
