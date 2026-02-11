import type { Message } from 'discord.js';

export function checkAllowlist(message: Message): boolean {
  // Stub implementation - allow all messages
  // TODO: Implement actual allowlist checking (users, roles, channels)
  return true;
}
