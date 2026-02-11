/**
 * Session Limits - Track turns per session and session duration
 * 
 * Enforces:
 * - MAX_TURNS_PER_SESSION: Maximum messages in a thread (0 = disabled)
 * - MAX_SESSION_DURATION_MS: Maximum session lifetime (0 = disabled)
 */

import { db } from '../db.js';

// In-memory turn counter: threadId -> turn count
const turnCounts = new Map<string, number>();

export function checkSessionLimits(threadId: string): boolean {
  const MAX_TURNS = parseInt(process.env.MAX_TURNS_PER_SESSION || '50');
  const MAX_DURATION_MS = parseInt(process.env.MAX_SESSION_DURATION_MS || '3600000');
  
  if (MAX_TURNS <= 0 && MAX_DURATION_MS <= 0) return true; // Disabled
  
  // Check turn limit
  if (MAX_TURNS > 0) {
    const turns = (turnCounts.get(threadId) || 0) + 1;
    turnCounts.set(threadId, turns);
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

// Exported for testing
export function resetSessionLimits(): void {
  turnCounts.clear();
}

export function getSessionTurns(threadId: string): number {
  return turnCounts.get(threadId) || 0;
}
