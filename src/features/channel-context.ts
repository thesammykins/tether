import type { TextChannel, ThreadChannel } from 'discord.js';

const MAX_CONTEXT_MESSAGES = 10;

export async function getChannelContext(channel: TextChannel | ThreadChannel): Promise<string> {
  try {
    const messages = await channel.messages.fetch({ limit: MAX_CONTEXT_MESSAGES });
    
    if (messages.size === 0) return '';
    
    // Build context string from most recent messages (reversed to chronological)
    const contextLines = Array.from(messages.values())
      .reverse()
      .filter(m => m.content && m.content.trim().length > 0)
      .map(m => `${m.author.tag}: ${m.content}`);
    
    if (contextLines.length === 0) return '';
    
    return `Recent channel context:\n${contextLines.join('\n')}`;
  } catch {
    return ''; // Fail silently — context is optional
  }
}
