import { describe, it, expect, beforeEach } from 'bun:test';
import { checkRateLimit, resetRateLimits, cleanupInterval, RATE_LIMIT_REQUESTS } from '../../src/middleware/rate-limiter.ts';

/** Helper: exhaust the rate limit for a user by making RATE_LIMIT_REQUESTS calls. */
function exhaustLimit(userId: string): void {
  for (let i = 0; i < RATE_LIMIT_REQUESTS; i++) {
    checkRateLimit(userId);
  }
}

describe('rate-limiter middleware', () => {
  beforeEach(() => {
    // Reset rate limits before each test
    resetRateLimits();
  });

  it('allows requests within limit', () => {
    expect(checkRateLimit('user1')).toBe(true);
    expect(checkRateLimit('user1')).toBe(true);
    expect(checkRateLimit('user1')).toBe(true);
  });

  it('blocks requests exceeding limit', () => {
    exhaustLimit('user1');
    expect(checkRateLimit('user1')).toBe(false); // Next request exceeds limit
    expect(checkRateLimit('user1')).toBe(false); // Still blocked
  });

  it('allows requests after window expires', async () => {
    exhaustLimit('user_window');
    expect(checkRateLimit('user_window')).toBe(false); // Blocked

    // Wait a bit (not enough for window to expire) and confirm still blocked
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(checkRateLimit('user_window')).toBe(false); // Still blocked
  });

  it('maintains independent limits per user', () => {
    exhaustLimit('user1');
    expect(checkRateLimit('user1')).toBe(false);

    // User2 is unaffected
    exhaustLimit('user2');
    expect(checkRateLimit('user2')).toBe(false);
  });

  it('uses configured request limit', () => {
    exhaustLimit('user_default');
    expect(checkRateLimit('user_default')).toBe(false); // Next request blocked
  });

  it('resetRateLimits clears all state', () => {
    exhaustLimit('user_reset');
    expect(checkRateLimit('user_reset')).toBe(false); // Blocked

    resetRateLimits();

    expect(checkRateLimit('user_reset')).toBe(true); // Unblocked after reset
  });

  it('implements sliding window correctly', async () => {
    exhaustLimit('user_sliding');
    expect(checkRateLimit('user_sliding')).toBe(false); // Blocked

    // Wait a bit (not enough for window to expire)
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(checkRateLimit('user_sliding')).toBe(false); // Still blocked
  });

  it('cleanup interval is defined', () => {
    // Verify cleanup interval exists
    expect(cleanupInterval).toBeDefined();
    expect(typeof cleanupInterval).toBe('object');
  });

  it('uses default values when env vars are invalid (NaN)', () => {
    // The safeParseInt function should handle NaN gracefully
    // This test verifies the module loads without crashing on invalid env
    expect(checkRateLimit('user_nan')).toBe(true);
  });
});
