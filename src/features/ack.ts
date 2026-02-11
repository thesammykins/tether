import type { Message } from 'discord.js';

export async function acknowledgeMessage(message: Message): Promise<void> {
  try {
    // React with 👀 to show the bot has seen the message
    await message.react('👀');
  } catch {
    // Silently fail if we can't react (permissions, etc.)
  }
}
