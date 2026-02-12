/**
 * Pause/Resume - Manage thread pausing and message queueing
 * 
 * Keywords:
 * - pause, stop, hold (or with ! prefix)
 * - resume, continue, unpause (or with ! prefix)
 * 
 * When paused, messages are stored in held_messages table.
 * When resumed, held messages can be retrieved via getHeldMessages().
 */

import type { Message } from 'discord.js';
import { db } from '../db.js';

const PAUSE_KEYWORDS = ['pause', 'stop', 'hold'];
const RESUME_KEYWORDS = ['resume', 'continue', 'unpause'];

export function handlePauseResume(message: Message): { paused: boolean; resumed?: boolean; heldMessages?: Array<{ author_id: string; content: string }> } {
  const content = message.content.toLowerCase().trim();
  const threadId = message.channel.isThread() ? message.channel.id : null;
  
  if (!threadId) return { paused: false }; // Only works in threads
  
  // Check for resume command
  if (RESUME_KEYWORDS.some(kw => content === kw || content === `!${kw}`)) {
    resumeThread(threadId);
    const heldMessages = getHeldMessages(threadId);
    return { paused: false, resumed: true, heldMessages };
  }
  
  // Check for pause command
  if (PAUSE_KEYWORDS.some(kw => content === kw || content === `!${kw}`)) {
    pauseThread(threadId, message.author.id);
    return { paused: true };
  }
  
  // Check if thread is currently paused
  if (isThreadPaused(threadId)) {
    // Hold this message
    holdMessage(threadId, message.author.id, message.content);
    return { paused: true };
  }
  
  return { paused: false };
}

function isThreadPaused(threadId: string): boolean {
  const row = db.query('SELECT 1 FROM paused_threads WHERE thread_id = ?').get(threadId);
  return !!row;
}

function pauseThread(threadId: string, userId: string): void {
  db.run(
    'INSERT OR REPLACE INTO paused_threads (thread_id, paused_at, paused_by) VALUES (?, ?, ?)',
    [threadId, Date.now(), userId]
  );
}

function resumeThread(threadId: string): void {
  db.run('DELETE FROM paused_threads WHERE thread_id = ?', [threadId]);
  // Held messages remain in the table — they can be processed by the caller
}

function holdMessage(threadId: string, authorId: string, content: string): void {
  db.run(
    'INSERT INTO held_messages (thread_id, author_id, content, created_at) VALUES (?, ?, ?, ?)',
    [threadId, authorId, content, Date.now()]
  );
}

// Exported for use by bot when resuming
export function getHeldMessages(threadId: string): Array<{ author_id: string; content: string }> {
  const rows = db.query(
    'SELECT author_id, content FROM held_messages WHERE thread_id = ? ORDER BY created_at ASC'
  ).all(threadId) as Array<{ author_id: string; content: string }>;
  
  // Clear held messages after retrieval
  db.run('DELETE FROM held_messages WHERE thread_id = ?', [threadId]);
  
  return rows;
}

// Exported for testing
export function isThreadPausedExport(threadId: string): boolean {
  return isThreadPaused(threadId);
}
