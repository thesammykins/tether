import type { TextChannel, ThreadChannel } from 'discord.js';

const MAX_CONTEXT_MESSAGES = 10;
const MAX_CONTEXT_LENGTH = 4000;

/**
 * Sanitize channel context to prevent prompt injection.
 * Strips any closing </channel_context> tags that could break wrapper.
 */
function sanitizeContext(text: string): string {
  return text.replace(/<\/channel_context>/gi, '&lt;/channel_context&gt;');
}

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
    
    let context = `Recent channel context:\n${contextLines.join('\n')}`;
    
    // Limit total length to prevent overwhelming the prompt
    if (context.length > MAX_CONTEXT_LENGTH) {
      context = context.substring(0, MAX_CONTEXT_LENGTH) + '...[truncated]';
    }
    
    // Strip any closing tags that could break the wrapper
    context = sanitizeContext(context);
    
    return context;
  } catch {
    return ''; // Fail silently — context is optional
  }
}
