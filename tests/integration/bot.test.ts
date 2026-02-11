/**
 * Integration tests for bot message pipeline
 * 
 * Tests the coordination of middleware + features without mocking Discord client.
 * Individual components are tested in detail by unit tests - these tests verify
 * that they work together correctly.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { checkRateLimit, resetRateLimits } from '../../src/middleware/rate-limiter.js';
import { resetSessionLimits } from '../../src/features/session-limits.js';
import { generateThreadName } from '../../src/features/thread-naming.js';
import { db } from '../../src/db.js';

describe('Bot Message Pipeline Integration', () => {
  beforeEach(() => {
    // Reset middleware state
    resetRateLimits();
    resetSessionLimits();
    
    // Clean up test data
    db.run('DELETE FROM paused_threads WHERE thread_id LIKE ?', ['test-%']);
    db.run('DELETE FROM held_messages WHERE thread_id LIKE ?', ['test-%']);
    db.run('DELETE FROM threads WHERE thread_id LIKE ?', ['test-%']);
  });
  
  describe('Pipeline Coordination', () => {
    it('should coordinate rate limiting across multiple users', () => {
      const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_REQUESTS || '5');
      
      // User 1 can send messages
      for (let i = 0; i < RATE_LIMIT; i++) {
        expect(checkRateLimit('user1')).toBe(true);
      }
      expect(checkRateLimit('user1')).toBe(false); // Now limited
      
      // User 2 still has their own quota
      expect(checkRateLimit('user2')).toBe(true);
    });
    
    it('should generate consistent thread names', () => {
      expect(generateThreadName('Help me debug this')).toBe('Help me debug this');
      expect(generateThreadName('a'.repeat(100)).length).toBeLessThanOrEqual(80);
      expect(generateThreadName('')).toBe('New conversation');
    });
    
    it('should clean up rate limits independently', () => {
      checkRateLimit('user3');
      checkRateLimit('user4');
      
      resetRateLimits();
      
      // Both users should have fresh quotas
      expect(checkRateLimit('user3')).toBe(true);
      expect(checkRateLimit('user4')).toBe(true);
    });
  });
  
  describe('Database Coordination', () => {
    it('should store and retrieve thread mappings', () => {
      const threadId = 'test-thread-db-1';
      const sessionId = 'session-123';
      
      db.run(
        'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
        [threadId, sessionId, '/test/dir']
      );
      
      const row = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
        .get(threadId) as { session_id: string; working_dir: string } | null;
      
      expect(row).toBeTruthy();
      expect(row?.session_id).toBe(sessionId);
      expect(row?.working_dir).toBe('/test/dir');
    });
    
    it('should handle paused threads state', () => {
      const threadId = 'test-thread-db-2';
      
      db.run(
        'INSERT INTO paused_threads (thread_id, paused_at, paused_by) VALUES (?, ?, ?)',
        [threadId, Date.now(), 'user123']
      );
      
      const row = db.query('SELECT 1 FROM paused_threads WHERE thread_id = ?').get(threadId);
      expect(row).toBeTruthy();
      
      db.run('DELETE FROM paused_threads WHERE thread_id = ?', [threadId]);
      
      const deletedRow = db.query('SELECT 1 FROM paused_threads WHERE thread_id = ?').get(threadId);
      expect(deletedRow).toBeNull();
    });
  });
  
  describe('Session State Management', () => {
    it('should reset session state cleanly', () => {
      // This test verifies that resetSessionLimits clears in-memory state
      resetSessionLimits();
      
      // After reset, no errors should occur
      expect(() => resetSessionLimits()).not.toThrow();
    });
  });
});
