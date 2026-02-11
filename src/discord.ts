/**
 * Discord utilities - Helper functions for posting to Discord
 *
 * Separated from bot.ts so the worker can send messages
 * without importing the full client.
 */

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
    console.warn('[discord] DISCORD_BOT_TOKEN not set - sendToThread will fail');
}

/**
 * Send a message to a Discord thread
 *
 * Uses the REST API directly so we don't need the gateway client
 */
export async function sendToThread(threadId: string, content: string): Promise<void> {
    // Discord message limit is 2000 chars
    const MAX_LENGTH = 2000;

    // Split long messages
    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
        if (remaining.length <= MAX_LENGTH) {
            chunks.push(remaining);
            break;
        }

        // Find a good split point (newline or space)
        let splitAt = remaining.lastIndexOf('\n', MAX_LENGTH);
        if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
            splitAt = remaining.lastIndexOf(' ', MAX_LENGTH);
        }
        if (splitAt === -1 || splitAt < MAX_LENGTH / 2) {
            splitAt = MAX_LENGTH;
        }

        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trim();
    }

    // Send each chunk
    for (const chunk of chunks) {
        const response = await fetch(
            `https://discord.com/api/v10/channels/${threadId}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: chunk }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Discord API error: ${response.status} ${error}`);
        }
    }
}

/**
 * Send typing indicator to a thread
 */
export async function sendTyping(channelId: string): Promise<void> {
    await fetch(
        `https://discord.com/api/v10/channels/${channelId}/typing`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            },
        }
    );
}
