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

const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;
const MAX_JITTER_MS = 500;

export interface DiscordResult {
    success: boolean;
    error?: string;
}

/**
 * Parse retry delay from 429 response
 * Priority order:
 * 1. retry_after from JSON body (seconds, can be float)
 * 2. Retry-After header (seconds)
 * 3. X-RateLimit-Reset-After header (seconds)
 * 4. Default fallback
 */
async function parseRetryDelay(response: Response): Promise<number> {
    // Try JSON body first (must clone to preserve original response)
    try {
        const cloned = response.clone();
        const body = await cloned.json() as Record<string, unknown>;
        if (typeof body.retry_after === 'number') {
            // retry_after is in seconds (can be float like 1.5)
            return Math.ceil(body.retry_after * 1000);
        }
    } catch {
        // Not JSON or no retry_after field, fall through to headers
    }

    // Try Retry-After header
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
        const seconds = parseFloat(retryAfter);
        if (!isNaN(seconds)) {
            return Math.ceil(seconds * 1000);
        }
    }

    // Try X-RateLimit-Reset-After header
    const resetAfter = response.headers.get('X-RateLimit-Reset-After');
    if (resetAfter) {
        const seconds = parseFloat(resetAfter);
        if (!isNaN(seconds)) {
            return Math.ceil(seconds * 1000);
        }
    }

    return DEFAULT_RETRY_DELAY_MS;
}

/**
 * Add jitter to prevent thundering herd
 */
function addJitter(delayMs: number): number {
    return delayMs + Math.floor(Math.random() * MAX_JITTER_MS);
}

/**
 * Make a Discord API request with timeout and retry logic
 */
async function discordRequest(
    url: string,
    options: RequestInit,
    retryCount = 0
): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle 429 rate limit
        if (response.status === 429 && retryCount < MAX_RETRIES) {
            const retryDelayMs = await parseRetryDelay(response);
            const jitteredDelay = addJitter(retryDelayMs);

            console.log(
                `[discord] Rate limited (429), retry ${retryCount + 1}/${MAX_RETRIES} after ${jitteredDelay}ms`
            );

            await new Promise(resolve => setTimeout(resolve, jitteredDelay));
            return discordRequest(url, options, retryCount + 1);
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }

        throw error;
    }
}

/**
 * Send a message to a Discord thread
 *
 * Uses the REST API directly so we don't need the gateway client
 * Returns success/error instead of throwing
 */
export async function sendToThread(threadId: string, content: string): Promise<DiscordResult> {
    try {
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
            const response = await discordRequest(
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
                return {
                    success: false,
                    error: `Discord API error: ${response.status} ${error}`,
                };
            }
        }

        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[discord] Request failed:', errorMessage);
        return {
            success: false,
            error: errorMessage,
        };
    }
}

/**
 * Send typing indicator to a thread
 */
export async function sendTyping(channelId: string): Promise<DiscordResult> {
    try {
        const response = await discordRequest(
            `https://discord.com/api/v10/channels/${channelId}/typing`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                },
            }
        );

        if (!response.ok) {
            const error = await response.text();
            return {
                success: false,
                error: `Discord API error: ${response.status} ${error}`,
            };
        }

        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[discord] Typing request failed:', errorMessage);
        return {
            success: false,
            error: errorMessage,
        };
    }
}
