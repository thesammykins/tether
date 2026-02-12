/**
 * HTTP API Server - Discord primitives for external tools
 *
 * Provides HTTP endpoints for sending messages, embeds, files, buttons,
 * and managing threads. Useful for scripts, automation, and Claude skills.
 */

import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const log = (msg: string) => process.stdout.write(`[api] ${msg}\n`);

// Button handler registry for dynamic button responses
type ButtonHandler = {
    type: 'inline';
    content: string;
    ephemeral?: boolean;
} | {
    type: 'webhook';
    url: string;
    data?: Record<string, unknown>;
};

export const buttonHandlers = new Map<string, ButtonHandler>();

// Question response store — maps requestId to response
export const questionResponses = new Map<string, { answer: string; optionIndex: number } | null>();

// Track which threads are waiting for a typed answer
export const pendingTypedAnswers = new Map<string, string>(); // threadId → requestId

// Pending questions with TTL tracking
type PendingQuestion = {
    timeoutId: NodeJS.Timeout;
};
export const pendingQuestions = new Map<string, PendingQuestion>();

// Binary file extensions - files with these extensions should be base64 encoded
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.bin', '.exe', '.dll', '.so', '.dylib',
]);

/**
 * Start the HTTP API server
 */
export function startApiServer(client: Client, port: number = 2643) {
    // Optional API token authentication
    const apiToken = process.env.API_TOKEN;
    const hostname = process.env.TETHER_API_HOST || '127.0.0.1';
    
    const server = Bun.serve({
        port,
        hostname,
        async fetch(req) {
            const url = new URL(req.url);
            const headers = { 'Content-Type': 'application/json' };

            // Authentication check - skip for /health endpoint
            if (apiToken && url.pathname !== '/health') {
                const authHeader = req.headers.get('Authorization');
                const expectedAuth = `Bearer ${apiToken}`;
                
                if (!authHeader || authHeader !== expectedAuth) {
                    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                        status: 401,
                        headers,
                    });
                }
            }

            // Health check
            if (url.pathname === '/health' && req.method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'ok',
                    connected: client.isReady(),
                    user: client.user?.tag || null,
                }), { headers });
            }

            // Send message to thread/channel
            if (url.pathname === '/command' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        command: string;
                        args: Record<string, unknown>;
                    };

                    const result = await handleCommand(client, body.command, body.args);
                    return new Response(JSON.stringify(result), { headers });
                } catch (error) {
                    log(`Command error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Send file attachment
            if (url.pathname === '/send-with-file' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        channelId: string;
                        fileName: string;
                        fileContent: string;
                        content?: string;
                        isBase64?: boolean;
                    };

                    const channel = await client.channels.fetch(body.channelId);
                    if (!channel?.isTextBased()) {
                        return new Response(JSON.stringify({ error: 'Invalid channel' }), {
                            status: 400,
                            headers,
                        });
                    }

                    // Determine encoding - check if file is binary based on extension
                    const ext = body.fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
                    const isBinary = ext ? BINARY_EXTENSIONS.has(ext) : false;
                    const encoding = body.isBase64 || isBinary ? 'base64' : 'utf-8';
                    
                    const buffer = Buffer.from(body.fileContent, encoding);
                    const message = await (channel as TextChannel).send({
                        content: body.content || undefined,
                        files: [{
                            attachment: buffer,
                            name: body.fileName,
                        }],
                    });

                    return new Response(JSON.stringify({
                        success: true,
                        messageId: message.id,
                    }), { headers });
                } catch (error) {
                    log(`Send file error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Send file via DM to a user
            if (url.pathname === '/send-dm-file' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        userId: string;
                        fileName: string;
                        fileContent: string;
                        content?: string;
                        isBase64?: boolean;
                    };

                    const user = await client.users.fetch(body.userId);
                    
                    // Determine encoding - check if file is binary based on extension
                    const ext = body.fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
                    const isBinary = ext ? BINARY_EXTENSIONS.has(ext) : false;
                    const encoding = body.isBase64 || isBinary ? 'base64' : 'utf-8';
                    
                    const buffer = Buffer.from(body.fileContent, encoding);
                    const message = await user.send({
                        content: body.content || undefined,
                        files: [{
                            attachment: buffer,
                            name: body.fileName,
                        }],
                    });

                    return new Response(JSON.stringify({
                        success: true,
                        messageId: message.id,
                        channelId: message.channelId,
                    }), { headers });
                } catch (error) {
                    log(`Send DM file error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Send message with buttons
            if (url.pathname === '/send-with-buttons' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        channelId: string;
                        content?: string;
                        embeds?: Array<{
                            title?: string;
                            description?: string;
                            color?: number;
                            fields?: Array<{ name: string; value: string; inline?: boolean }>;
                            footer?: { text: string };
                        }>;
                        buttons: Array<{
                            label: string;
                            customId: string;
                            style: number | 'primary' | 'secondary' | 'success' | 'danger';
                            handler?: ButtonHandler;
                        }>;
                    };

                    const channel = await client.channels.fetch(body.channelId);
                    if (!channel?.isTextBased()) {
                        return new Response(JSON.stringify({ error: 'Invalid channel' }), {
                            status: 400,
                            headers,
                        });
                    }

                    // Build embed if provided
                    const embeds = body.embeds?.map(e => {
                        const embed = new EmbedBuilder();
                        if (e.title) embed.setTitle(e.title);
                        if (e.description) embed.setDescription(e.description);
                        if (e.color) embed.setColor(e.color);
                        if (e.fields) embed.addFields(e.fields);
                        if (e.footer) embed.setFooter(e.footer);
                        return embed;
                    });

                    // Build button row - handle both number and string styles
                    const styleMap: Record<string, ButtonStyle> = {
                        primary: ButtonStyle.Primary,
                        secondary: ButtonStyle.Secondary,
                        success: ButtonStyle.Success,
                        danger: ButtonStyle.Danger,
                    };

                    const buttons = body.buttons.map(b => {
                        // Register handler if provided
                        if (b.handler) {
                            buttonHandlers.set(b.customId, b.handler);
                            log(`Registered button handler: ${b.customId}`);
                        } else {
                            log(`No handler for button: ${b.customId}`);
                        }
                        
                        // Handle both number styles (from CLI) and string styles (legacy)
                        let buttonStyle: ButtonStyle;
                        if (typeof b.style === 'number') {
                            buttonStyle = b.style as ButtonStyle;
                        } else {
                            buttonStyle = styleMap[b.style] || ButtonStyle.Primary;
                        }
                        
                        return new ButtonBuilder()
                            .setCustomId(b.customId)
                            .setLabel(b.label)
                            .setStyle(buttonStyle);
                    });

                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

                    const message = await (channel as TextChannel).send({
                        content: body.content || undefined,
                        embeds: embeds || undefined,
                        components: [row],
                    });

                    // Register question buttons with TTL (5 minutes)
                    // Extract requestId from button customIds that match "ask_<uuid>_*" pattern
                    body.buttons.forEach(b => {
                        const match = b.customId.match(/^ask_([a-f0-9-]+)_/);
                        if (match) {
                            const requestId = match[1];
                            // Only register once per requestId
                            if (!pendingQuestions.has(requestId)) {
                                const timeoutId = setTimeout(() => {
                                    pendingQuestions.delete(requestId);
                                    questionResponses.delete(requestId);
                                    log(`Question ${requestId} expired after 5 minutes`);
                                }, 300_000); // 5 minutes
                                
                                pendingQuestions.set(requestId, { timeoutId });
                                log(`Registered question ${requestId} with 5-minute TTL`);
                            }
                        }
                    });

                    return new Response(JSON.stringify({
                        success: true,
                        messageId: message.id,
                    }), { headers });
                } catch (error) {
                    log(`Send buttons error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Question response webhook - POST /question-response/:requestId
            if (url.pathname.startsWith('/question-response/') && req.method === 'POST') {
                try {
                    const requestId = url.pathname.split('/question-response/')[1];
                    if (!requestId) {
                        return new Response(JSON.stringify({ error: 'Missing requestId' }), {
                            status: 400,
                            headers,
                        });
                    }

                    const body = await req.json() as {
                        customId: string;
                        userId: string;
                        channelId: string;
                        data: {
                            option: string;
                            optionIndex: number;
                            threadId?: string;
                        };
                    };

                    // Store the response
                    questionResponses.set(requestId, {
                        answer: body.data.option,
                        optionIndex: body.data.optionIndex,
                    });

                    // If user clicked "Type answer", track it
                    if (body.data.option === '__type__' && body.data.threadId) {
                        pendingTypedAnswers.set(body.data.threadId, requestId);
                    }

                    // Clear TTL timeout if it exists
                    const pending = pendingQuestions.get(requestId);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        pendingQuestions.delete(requestId);
                    }

                    // Auto-cleanup after 10 minutes
                    setTimeout(() => questionResponses.delete(requestId), 600_000);

                    log(`Question response stored: ${requestId} → ${body.data.option}`);

                    return new Response(JSON.stringify({ success: true }), { headers });
                } catch (error) {
                    log(`Question response error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Get question response - GET /question-response/:requestId
            if (url.pathname.startsWith('/question-response/') && req.method === 'GET') {
                const requestId = url.pathname.split('/question-response/')[1];
                if (!requestId) {
                    return new Response(JSON.stringify({ error: 'Missing requestId' }), {
                        status: 400,
                        headers,
                    });
                }

                if (!questionResponses.has(requestId)) {
                    return new Response(JSON.stringify({ error: 'Unknown requestId' }), {
                        status: 404,
                        headers,
                    });
                }

                const response = questionResponses.get(requestId);
                if (response === null || response === undefined) {
                    // Registered but not yet answered (or not found, but we checked has() above)
                    return new Response(JSON.stringify({ answered: false }), { headers });
                }

                // Answered
                return new Response(JSON.stringify({
                    answered: true,
                    answer: response.answer,
                    optionIndex: response.optionIndex,
                }), { headers });
            }

            // 404 for unknown routes
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers,
            });
        },
    });

    log(`HTTP API server listening on ${hostname}:${port}`);
    return server;
}

/**
 * Handle a command from the /command endpoint
 */
async function handleCommand(
    client: Client,
    command: string,
    args: Record<string, unknown>
): Promise<Record<string, unknown>> {
    switch (command) {
        case 'send-to-thread': {
            const threadId = args.thread as string;
            const message = args.message as string | undefined;
            const embeds = args.embeds as Array<{
                title?: string;
                description?: string;
                color?: number;
                fields?: Array<{ name: string; value: string; inline?: boolean }>;
                footer?: { text: string };
            }> | undefined;

            const channel = await client.channels.fetch(threadId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid thread/channel');
            }

            // Build embeds if provided
            const discordEmbeds = embeds?.map(e => {
                const embed = new EmbedBuilder();
                if (e.title) embed.setTitle(e.title);
                if (e.description) embed.setDescription(e.description);
                if (e.color) embed.setColor(e.color);
                if (e.fields) embed.addFields(e.fields);
                if (e.footer) embed.setFooter(e.footer);
                return embed;
            });

            const sent = await (channel as TextChannel).send({
                content: message || undefined,
                embeds: discordEmbeds || undefined,
            });

            return { success: true, messageId: sent.id };
        }

        case 'start-typing': {
            const channelId = args.channel as string;
            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }
            await (channel as TextChannel).sendTyping();
            return { success: true };
        }

        case 'edit-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const content = args.content as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.edit(content);
            return { success: true };
        }

        case 'delete-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.delete();
            return { success: true };
        }

        case 'rename-thread': {
            const threadId = args.thread as string;
            const name = args.name as string;

            const channel = await client.channels.fetch(threadId);
            if (!channel?.isThread()) {
                throw new Error('Invalid thread');
            }

            await channel.setName(name);
            return { success: true };
        }

        case 'reply-to-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const content = args.content as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const targetMessage = await (channel as TextChannel).messages.fetch(messageId);
            const sent = await targetMessage.reply(content);
            return { success: true, messageId: sent.id };
        }

        case 'create-thread': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const name = args.name as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            const thread = await message.startThread({ name });
            return { success: true, threadId: thread.id };
        }

        case 'add-reaction': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const emoji = args.emoji as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.react(emoji);
            return { success: true };
        }

        case 'send-dm': {
            const userId = args.userId as string;
            const message = args.message as string | undefined;
            const embeds = args.embeds as Array<{
                title?: string;
                description?: string;
                color?: number;
                fields?: Array<{ name: string; value: string; inline?: boolean }>;
                footer?: { text: string };
            }> | undefined;

            if (!userId) throw new Error('userId is required');
            if (!message && !embeds?.length) throw new Error('message or embeds required');

            const user = await client.users.fetch(userId);
            const discordEmbeds = embeds?.map(e => {
                const embed = new EmbedBuilder();
                if (e.title) embed.setTitle(e.title);
                if (e.description) embed.setDescription(e.description);
                if (e.color) embed.setColor(e.color);
                if (e.fields) embed.addFields(e.fields);
                if (e.footer) embed.setFooter(e.footer);
                return embed;
            });

            const sent = await user.send({
                content: message || undefined,
                embeds: discordEmbeds || undefined,
            });

            return { success: true, messageId: sent.id, channelId: sent.channelId };
        }

        default:
            throw new Error(`Unknown command: ${command}`);
    }
}
