/**
 * Tests for session-limits.ts
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

// Set test database path before importing anything
const testDbPath = './data/test-threads.db';
process.env.DB_PATH = testDbPath;

import { checkSessionLimits, resetSessionLimits, getSessionTurns } from '../../src/features/session-limits';
import { db } from '../../src/db';

// Set up test database schema
beforeEach(() => {
  db.run(`DELETE FROM threads`);
  resetSessionLimits();
});

afterAll(() => {
  // Clean up test database
  try {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  } catch {}
});

describe('session-limits', () => {
  test('within turn limit returns true', () => {
    // Set MAX_TURNS_PER_SESSION=50 (default)
    process.env.MAX_TURNS_PER_SESSION = '50';
    process.env.MAX_SESSION_DURATION_MS = '0'; // Disable duration limit
    
    const threadId = 'thread-1';
    
    // First 50 calls should return true
    for (let i = 0; i < 50; i++) {
      expect(checkSessionLimits(threadId)).toBe(true);
    }
    
    expect(getSessionTurns(threadId)).toBe(50);
  });

  test('exceeding turn limit returns false', () => {
    process.env.MAX_TURNS_PER_SESSION = '3';
    process.env.MAX_SESSION_DURATION_MS = '0';
    
    const threadId = 'thread-2';
    
    expect(checkSessionLimits(threadId)).toBe(true); // 1
    expect(checkSessionLimits(threadId)).toBe(true); // 2
    expect(checkSessionLimits(threadId)).toBe(true); // 3
    expect(checkSessionLimits(threadId)).toBe(false); // 4 - exceeds limit
    expect(checkSessionLimits(threadId)).toBe(false); // 5 - still exceeds
  });

  test('within duration returns true', () => {
    process.env.MAX_TURNS_PER_SESSION = '0'; // Disable turn limit
    process.env.MAX_SESSION_DURATION_MS = '3600000'; // 1 hour
    
    const threadId = 'thread-3';
    
    // Insert a thread created just now
    db.run(
      'INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
      [threadId, 'session-3', new Date().toISOString()]
    );
    
    expect(checkSessionLimits(threadId)).toBe(true);
  });

  test('exceeding duration returns false', () => {
    process.env.MAX_TURNS_PER_SESSION = '0';
    process.env.MAX_SESSION_DURATION_MS = '1000'; // 1 second
    
    const threadId = 'thread-4';
    
    // Insert a thread created 2 seconds ago
    const twoSecondsAgo = new Date(Date.now() - 2000).toISOString();
    db.run(
      'INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
      [threadId, 'session-4', twoSecondsAgo]
    );
    
    expect(checkSessionLimits(threadId)).toBe(false);
  });

  test('limits disabled (0 values) always returns true', () => {
    process.env.MAX_TURNS_PER_SESSION = '0';
    process.env.MAX_SESSION_DURATION_MS = '0';
    
    const threadId = 'thread-5';
    
    // Should always return true regardless of calls
    for (let i = 0; i < 100; i++) {
      expect(checkSessionLimits(threadId)).toBe(true);
    }
  });

  test('resetSessionLimits clears turn counts', () => {
    process.env.MAX_TURNS_PER_SESSION = '5';
    process.env.MAX_SESSION_DURATION_MS = '0';
    
    const threadId = 'thread-6';
    
    checkSessionLimits(threadId);
    checkSessionLimits(threadId);
    expect(getSessionTurns(threadId)).toBe(2);
    
    resetSessionLimits();
    expect(getSessionTurns(threadId)).toBe(0);
  });

  test('independent tracking per thread', () => {
    process.env.MAX_TURNS_PER_SESSION = '3';
    process.env.MAX_SESSION_DURATION_MS = '0';
    
    const thread1 = 'thread-7';
    const thread2 = 'thread-8';
    
    checkSessionLimits(thread1);
    checkSessionLimits(thread1);
    checkSessionLimits(thread2);
    
    expect(getSessionTurns(thread1)).toBe(2);
    expect(getSessionTurns(thread2)).toBe(1);
    
    checkSessionLimits(thread1);
    expect(checkSessionLimits(thread1)).toBe(false); // 4th call exceeds
    expect(checkSessionLimits(thread2)).toBe(true); // thread2 still under limit
  });
});
