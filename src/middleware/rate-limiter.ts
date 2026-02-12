/**
 * Sliding window rate limiter using in-memory Map.
 * 
 * Advantages over DB:
 * - Faster (no I/O overhead)
 * - Simpler (no cleanup job needed)
 * - Sufficient for single-instance bot
 */

// Safe parseInt with NaN fallback
function safeParseInt(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const RATE_LIMIT_REQUESTS = safeParseInt(process.env.RATE_LIMIT_REQUESTS, 10);
const RATE_LIMIT_WINDOW_MS = safeParseInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);

// In-memory sliding window: userId -> array of timestamps
const userTimestamps = new Map<string, number[]>();

/**
 * Check if user is within rate limit.
 * Returns true if request is allowed, false if rate limited.
 */
export function checkRateLimit(userId: string): boolean {
  if (RATE_LIMIT_REQUESTS <= 0) return true; // Disabled
  
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  
  let timestamps = userTimestamps.get(userId) || [];
  
  // Remove expired timestamps
  timestamps = timestamps.filter(t => t > windowStart);
  
  if (timestamps.length >= RATE_LIMIT_REQUESTS) {
    userTimestamps.set(userId, timestamps);
    return false; // Rate limited
  }
  
  timestamps.push(now);
  userTimestamps.set(userId, timestamps);
  return true;
}

/**
 * Cleanup expired entries from userTimestamps map.
 * Removes users whose all timestamps are older than the rate limit window.
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  
  for (const [userId, timestamps] of userTimestamps.entries()) {
    // If all timestamps are expired, remove the user entry
    const hasValidTimestamp = timestamps.some(t => t > windowStart);
    if (!hasValidTimestamp) {
      userTimestamps.delete(userId);
    }
  }
}

// Run cleanup every 60 seconds
const cleanupInterval = setInterval(cleanupExpiredEntries, 60000);

// Export cleanup interval for testing
export { cleanupInterval };

/**
 * Reset all rate limits (exported for testing).
 */
export function resetRateLimits(): void {
  userTimestamps.clear();
}
