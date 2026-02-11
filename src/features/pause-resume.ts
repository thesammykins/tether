import type { Message } from 'discord.js';

export function handlePauseResume(message: Message): { paused: boolean } {
  // Stub implementation - never paused
  // TODO: Implement pause/resume logic using paused_threads and held_messages tables
  return { paused: false };
}
