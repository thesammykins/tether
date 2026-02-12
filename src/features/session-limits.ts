/**
 * Session Limits - Track turns per session and session duration
 * 
 * Enforces:
 * - MAX_TURNS_PER_SESSION: Maximum messages in a thread (0 = disabled)
 * - MAX_SESSION_DURATION_MS: Maximum session lifetime (0 = disabled)
 */

import { db } from '../db.js';

// Safe parseInt with NaN fallback
function safeParseInt(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

// In-memory turn counter: threadId -> { turns: number, lastAccess: number }
const turnCounts = new Map<string, { turns: number; lastAccess: number }>();

export function checkSessionLimits(threadId: string): boolean {
  const MAX_TURNS = safeParseInt(process.env.MAX_TURNS_PER_SESSION, 50);
  const MAX_DURATION_MS = safeParseInt(process.env.MAX_SESSION_DURATION_MS, 1800000);
  
  if (MAX_TURNS <= 0 && MAX_DURATION_MS <= 0) return true; // Disabled
  
  // Check turn limit
  if (MAX_TURNS > 0) {
    const entry = turnCounts.get(threadId);
    const turns = (entry?.turns || 0) + 1;
    turnCounts.set(threadId, { turns, lastAccess: Date.now() });
    if (turns > MAX_TURNS) return false;
  }
  
  // Check duration limit
  if (MAX_DURATION_MS > 0) {
    const thread = db.query('SELECT created_at FROM threads WHERE thread_id = ?')
      .get(threadId) as { created_at: string } | null;
    
    if (thread) {
      const created = new Date(thread.created_at).getTime();
      if (Date.now() - created > MAX_DURATION_MS) return false;
    }
  }
  
  return true;
}

/**
 * Cleanup expired sessions from turnCounts map.
 * Removes sessions older than MAX_SESSION_DURATION_MS from in-memory cache.
 */
function cleanupExpiredSessions(): void {
  const MAX_DURATION_MS = safeParseInt(process.env.MAX_SESSION_DURATION_MS, 1800000);
  if (MAX_DURATION_MS <= 0) return; // Cleanup disabled if duration check is disabled
  
  const now = Date.now();
  
  for (const [threadId, entry] of turnCounts.entries()) {
    // Remove entries that haven't been accessed in MAX_DURATION_MS
    if (now - entry.lastAccess > MAX_DURATION_MS) {
      turnCounts.delete(threadId);
    }
  }
}

// Run cleanup every 60 seconds
const cleanupInterval = setInterval(cleanupExpiredSessions, 60000);

// Export cleanup interval for testing
export { cleanupInterval };

// Exported for testing
export function resetSessionLimits(): void {
  turnCounts.clear();
}

export function getSessionTurns(threadId: string): number {
  return turnCounts.get(threadId)?.turns || 0;
}
