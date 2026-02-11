/**
 * Tests for pause-resume.ts
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';
import type { Message } from 'discord.js';

// Set test database path before importing anything
const testDbPath = './data/test-pause-resume.db';
process.env.DB_PATH = testDbPath;

import { handlePauseResume, getHeldMessages, isThreadPausedExport } from '../../src/features/pause-resume';
import { db } from '../../src/db';

// Set up test database schema
beforeEach(() => {
  db.run(`DELETE FROM paused_threads`);
  db.run(`DELETE FROM held_messages`);
});

afterAll(() => {
  // Clean up test database
  try {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  } catch {}
});

// Mock Discord.js Message object
function mockMessage(content: string, threadId: string | null, authorId = 'user-123'): Message {
  return {
    content,
    author: {
      id: authorId,
      bot: false,
    },
    channel: {
      isThread: () => !!threadId,
      id: threadId || 'channel-1',
    },
  } as unknown as Message;
}

describe('pause-resume', () => {
  test('normal message in non-thread returns paused: false', () => {
    const message = mockMessage('hello', null);
    const result = handlePauseResume(message);
    expect(result.paused).toBe(false);
  });

  test('"pause" in thread returns paused: true and pauses thread', () => {
    const threadId = 'thread-1';
    const message = mockMessage('pause', threadId);
    
    const result = handlePauseResume(message);
    expect(result.paused).toBe(true);
    expect(isThreadPausedExport(threadId)).toBe(true);
  });

  test('"resume" in paused thread returns paused: false and unpauses', () => {
    const threadId = 'thread-2';
    
    // First pause the thread
    const pauseMsg = mockMessage('pause', threadId);
    handlePauseResume(pauseMsg);
    expect(isThreadPausedExport(threadId)).toBe(true);
    
    // Then resume it
    const resumeMsg = mockMessage('resume', threadId);
    const result = handlePauseResume(resumeMsg);
    expect(result.paused).toBe(false);
    expect(isThreadPausedExport(threadId)).toBe(false);
  });

  test('message in paused thread returns paused: true and holds message', () => {
    const threadId = 'thread-3';
    
    // Pause the thread
    handlePauseResume(mockMessage('pause', threadId, 'user-1'));
    
    // Send a message while paused
    const result = handlePauseResume(mockMessage('hello world', threadId, 'user-2'));
    expect(result.paused).toBe(true);
    
    // Check that message was held
    const held = getHeldMessages(threadId);
    expect(held.length).toBe(1);
    expect(held[0].author_id).toBe('user-2');
    expect(held[0].content).toBe('hello world');
  });

  test('getHeldMessages returns and clears held messages', () => {
    const threadId = 'thread-4';
    
    // Pause and send multiple messages
    handlePauseResume(mockMessage('pause', threadId, 'user-1'));
    handlePauseResume(mockMessage('message 1', threadId, 'user-2'));
    handlePauseResume(mockMessage('message 2', threadId, 'user-3'));
    handlePauseResume(mockMessage('message 3', threadId, 'user-2'));
    
    // Get held messages
    const held = getHeldMessages(threadId);
    expect(held.length).toBe(3);
    expect(held[0].content).toBe('message 1');
    expect(held[1].content).toBe('message 2');
    expect(held[2].content).toBe('message 3');
    
    // Verify they were cleared
    const heldAgain = getHeldMessages(threadId);
    expect(heldAgain.length).toBe(0);
  });

  test('"!pause" and "!resume" work (with prefix)', () => {
    const threadId = 'thread-5';
    
    // Test !pause
    const pauseResult = handlePauseResume(mockMessage('!pause', threadId));
    expect(pauseResult.paused).toBe(true);
    expect(isThreadPausedExport(threadId)).toBe(true);
    
    // Test !resume
    const resumeResult = handlePauseResume(mockMessage('!resume', threadId));
    expect(resumeResult.paused).toBe(false);
    expect(isThreadPausedExport(threadId)).toBe(false);
  });

  test('case insensitive keywords', () => {
    const threadId = 'thread-6';
    
    // Test uppercase
    handlePauseResume(mockMessage('PAUSE', threadId));
    expect(isThreadPausedExport(threadId)).toBe(true);
    
    handlePauseResume(mockMessage('RESUME', threadId));
    expect(isThreadPausedExport(threadId)).toBe(false);
    
    // Test mixed case
    handlePauseResume(mockMessage('PaUsE', threadId));
    expect(isThreadPausedExport(threadId)).toBe(true);
    
    handlePauseResume(mockMessage('ReSuMe', threadId));
    expect(isThreadPausedExport(threadId)).toBe(false);
  });

  test('all pause keywords work', () => {
    const threadIds = ['thread-7', 'thread-8', 'thread-9'];
    const keywords = ['pause', 'stop', 'hold'];
    
    keywords.forEach((keyword, i) => {
      handlePauseResume(mockMessage(keyword, threadIds[i]));
      expect(isThreadPausedExport(threadIds[i])).toBe(true);
    });
  });

  test('all resume keywords work', () => {
    const threadIds = ['thread-10', 'thread-11', 'thread-12'];
    const keywords = ['resume', 'continue', 'unpause'];
    
    threadIds.forEach((id, i) => {
      // First pause
      handlePauseResume(mockMessage('pause', id));
      expect(isThreadPausedExport(id)).toBe(true);
      
      // Then resume with different keywords
      handlePauseResume(mockMessage(keywords[i], id));
      expect(isThreadPausedExport(id)).toBe(false);
    });
  });
});
