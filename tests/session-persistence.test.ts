/**
 * Tests for session persistence features
 * 
 * Tests updateSessionId() function that updates thread session IDs
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

// Set test database path before importing db
const testDbPath = './data/test-session-persistence.db';
process.env.DB_PATH = testDbPath;

import { db, updateSessionId } from '../src/db';

beforeEach(() => {
  // Clean up test data
  db.run('DELETE FROM threads WHERE thread_id LIKE ?', ['test-%']);
});

afterAll(() => {
  // Clean up test database
  try {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  } catch {}
});

describe('Session Persistence', () => {
  describe('updateSessionId', () => {
    it('should update session_id for existing thread', () => {
      const threadId = 'test-thread-1';
      const oldSessionId = 'session-old-123';
      const newSessionId = 'session-new-456';

      // Insert test thread
      db.run(
        'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
        [threadId, oldSessionId, '/test/dir']
      );

      // Update session ID
      updateSessionId(threadId, newSessionId);

      // Verify update
      const row = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
        .get(threadId) as { session_id: string } | null;

      expect(row).toBeTruthy();
      expect(row?.session_id).toBe(newSessionId);
    });

    it('should be a no-op for non-existent thread', () => {
      const threadId = 'test-thread-nonexistent';
      const sessionId = 'session-999';

      // Ensure thread does not exist
      const before = db.query('SELECT COUNT(*) as count FROM threads WHERE thread_id = ?')
        .get(threadId) as { count: number };
      expect(before.count).toBe(0);

      // Call updateSessionId - should not crash
      expect(() => updateSessionId(threadId, sessionId)).not.toThrow();

      // Verify no row was created
      const after = db.query('SELECT COUNT(*) as count FROM threads WHERE thread_id = ?')
        .get(threadId) as { count: number };
      expect(after.count).toBe(0);
    });

    it('should preserve working_dir when updating session_id', () => {
      const threadId = 'test-thread-2';
      const oldSessionId = 'session-old-789';
      const newSessionId = 'session-new-101';
      const workingDir = '/my/working/dir';

      // Insert test thread with working_dir
      db.run(
        'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
        [threadId, oldSessionId, workingDir]
      );

      // Update session ID
      updateSessionId(threadId, newSessionId);

      // Verify working_dir is preserved
      const row = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
        .get(threadId) as { session_id: string; working_dir: string } | null;

      expect(row).toBeTruthy();
      if (row) {
        expect(row.session_id).toBe(newSessionId);
        expect(row.working_dir).toBe(workingDir);
      }
    });

    it('should handle multiple updates to same thread', () => {
      const threadId = 'test-thread-3';
      const sessions = ['session-1', 'session-2', 'session-3'];

      // Insert initial thread
      db.run(
        'INSERT INTO threads (thread_id, session_id) VALUES (?, ?)',
        [threadId, sessions[0] as string]
      );

      // Update multiple times
      if (sessions[1]) updateSessionId(threadId, sessions[1]);
      if (sessions[2]) updateSessionId(threadId, sessions[2]);

      // Verify final state
      const row = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
        .get(threadId) as { session_id: string } | null;

      expect(row?.session_id).toBe(sessions[2]);
    });
  });
});
