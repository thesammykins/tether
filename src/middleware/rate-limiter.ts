/**
 * Sliding window rate limiter using in-memory Map.
 * 
 * Advantages over DB:
 * - Faster (no I/O overhead)
 * - Simpler (no cleanup job needed)
 * - Sufficient for single-instance bot
 */

const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '5');
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

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
 * Reset all rate limits (exported for testing).
 */
export function resetRateLimits(): void {
  userTimestamps.clear();
}
