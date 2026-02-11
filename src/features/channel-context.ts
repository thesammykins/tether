import type { TextChannel, ThreadChannel } from 'discord.js';

export async function getChannelContext(channel: TextChannel | ThreadChannel): Promise<string> {
  // Stub implementation - return empty context
  // TODO: Implement channel context gathering (recent messages, channel description, etc.)
  return '';
}
