/**
 * Discord Bot - Catches @mentions, creates threads, forwards to queue
 *
 * This is the entry point for the Discord → Claude bridge.
 * When someone @mentions the bot, it:
 * 1. Creates a thread for the conversation
 * 2. Queues the message for Claude processing
 * 3. Posts responses back to the thread
 */

import {
    Client,
    GatewayIntentBits,
    Events,
    Message,
    TextChannel,
    DMChannel,
    ChannelType,
    Partials,
    ThreadAutoArchiveDuration,
    SlashCommandBuilder,
    type Interaction,
} from 'discord.js';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { claudeQueue } from './queue.js';
import { db, getChannelConfigCached, setChannelConfig } from './db.js';
import { startApiServer, buttonHandlers } from './api.js';
import { checkAllowlist } from './middleware/allowlist.js';
import { checkRateLimit } from './middleware/rate-limiter.js';
import { acknowledgeMessage } from './features/ack.js';
import { getChannelContext } from './features/channel-context.js';
import { generateThreadName } from './features/thread-naming.js';
import { checkSessionLimits } from './features/session-limits.js';
import { handlePauseResume } from './features/pause-resume.js';
import { isBrbMessage, isBackMessage, setBrb, setBack } from './features/brb.js';
import { questionResponses, pendingTypedAnswers } from './api.js';

// DM support - opt-in via env var (disabled by default for security)
const ENABLE_DMS = process.env.ENABLE_DMS === 'true';

// Allowed working directories (configurable via env, comma-separated)
// If not set, any existing directory is allowed (backward compatible)
const ALLOWED_DIRS = process.env.CORD_ALLOWED_DIRS
    ? process.env.CORD_ALLOWED_DIRS.split(',').map(d => resolve(d.trim()))
    : null;

/**
 * Validate that a path is within the allowed directories.
 * Returns null if valid, or an error message if invalid.
 */
function validateWorkingDir(dir: string): string | null {
    // Resolve to absolute path
    const resolved = resolve(dir);

    // If no allowlist configured, just check existence
    if (!ALLOWED_DIRS) {
        if (!existsSync(resolved)) {
            return `Directory not found: \`${dir}\``;
        }
        return null;
    }

    // Check against allowlist
    const isAllowed = ALLOWED_DIRS.some(allowed =>
        resolved === allowed || resolved.startsWith(allowed + '/')
    );

    if (!isAllowed) {
        return `Directory not in allowed list. Allowed: ${ALLOWED_DIRS.join(', ')}`;
    }

    if (!existsSync(resolved)) {
        return `Directory not found: \`${dir}\``;
    }

    return null;
}

// Force unbuffered logging
const log = (msg: string) => process.stdout.write(`[bot] ${msg}\n`);

// Helper function to resolve working directory from message or channel config
function resolveWorkingDir(message: string, channelId: string): { workingDir: string; cleanedMessage: string; error?: string } {
    // Check for [/path] prefix override
    const pathMatch = message.match(/^\[([^\]]+)\]\s*/);
    if (pathMatch && pathMatch[1]) {
        let dir = pathMatch[1];
        // Expand ~ to home directory
        if (dir.startsWith('~')) {
            dir = dir.replace('~', homedir());
        }
        const validationError = validateWorkingDir(dir);
        if (validationError) {
            return {
                workingDir: '',
                cleanedMessage: message.slice(pathMatch[0].length),
                error: validationError
            };
        }
        return {
            workingDir: resolve(dir),
            cleanedMessage: message.slice(pathMatch[0].length)
        };
    }

    // Check channel config (cached)
    const channelConfig = getChannelConfigCached(channelId);
    if (channelConfig?.working_dir) {
        return { workingDir: channelConfig.working_dir, cleanedMessage: message };
    }

    // Fall back to env or cwd
    return {
        workingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
        cleanedMessage: message
    };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        // DM support — partials required because DM channels are uncached
        ...(ENABLE_DMS ? [
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageReactions,
        ] : []),
    ],
    // Partials.Channel is required for DMs — DM channels aren't cached by default
    partials: ENABLE_DMS ? [Partials.Channel] : [],
});

client.once(Events.ClientReady, async (c) => {
    log(`Logged in as ${c.user.tag}`);

    // Register slash commands (only if not already registered)
    const existingCommands = await c.application?.commands.fetch();
    const cordCommand = existingCommands?.find(cmd => cmd.name === 'cord');

    if (!cordCommand) {
        const command = new SlashCommandBuilder()
            .setName('cord')
            .setDescription('Configure Cord bot')
            .addSubcommand(sub =>
                sub.setName('config')
                   .setDescription('Configure channel settings')
                   .addStringOption(opt =>
                       opt.setName('dir')
                          .setDescription('Working directory for Claude in this channel')
                          .setRequired(true)
                   )
            );

        await c.application?.commands.create(command);
        log('Slash commands registered');
    } else {
        log('Slash commands already registered');
    }

    // Start HTTP API server
    const apiPort = parseInt(process.env.API_PORT || '2643');
    startApiServer(client, apiPort);
});

// Handle slash command and button interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // Handle /cord slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'cord') {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'config') {
            let dir = interaction.options.getString('dir', true);

            // Expand ~ to home directory
            if (dir.startsWith('~')) {
                dir = dir.replace('~', homedir());
            }

            // Validate path against allowlist and check existence
            const validationError = validateWorkingDir(dir);
            if (validationError) {
                await interaction.reply({
                    content: validationError,
                    ephemeral: true
                });
                return;
            }

            // Resolve to absolute path before storing
            dir = resolve(dir);

            setChannelConfig(interaction.channelId, dir);
            await interaction.reply({
                content: `Working directory set to \`${dir}\` for this channel.`,
                ephemeral: true
            });
            log(`Channel ${interaction.channelId} configured with working dir: ${dir}`);
        }
        return;
    }

    if (!interaction.isButton()) return;

    log(`Looking up handler for: ${interaction.customId}`);
    log(`Available handlers: ${Array.from(buttonHandlers.keys()).join(', ') || 'none'}`);
    const handler = buttonHandlers.get(interaction.customId);
    if (!handler) {
        log(`No handler found for: ${interaction.customId}`);
        await interaction.reply({ content: 'This button has expired.', ephemeral: true });
        return;
    }

    try {
        if (handler.type === 'inline') {
            await interaction.reply({
                content: handler.content,
                ephemeral: handler.ephemeral ?? false,
            });
        } else         if (handler.type === 'webhook') {
            await interaction.deferReply({ ephemeral: true });
            const response = await fetch(handler.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customId: interaction.customId,
                    userId: interaction.user.id,
                    channelId: interaction.channelId,
                    data: handler.data,
                }),
            });
            const result = await response.json() as { content?: string };

            // If this was a "Type answer" button, prompt the user to type below
            const isTypeAnswer = handler.data && (handler.data as Record<string, unknown>).option === '__type__';
            await interaction.editReply({
                content: isTypeAnswer
                    ? '✏️ Type your answer below in this thread — your next message will be captured.'
                    : (result.content || 'Done.'),
            });
        }
    } catch (error) {
        log(`Button handler error: ${error}`);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        }
    }
});

client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bots
    if (message.author.bot) return;

    // =========================================================================
    // DM MESSAGES: Direct messages to the bot
    // =========================================================================
    const isDM = message.channel.type === ChannelType.DM;

    if (isDM) {
        if (!ENABLE_DMS) return; // DMs disabled — silently ignore

        // Middleware: Check allowlist (user only — no roles/channels in DMs)
        if (!checkAllowlist(message)) return;

        // Middleware: Check rate limits
        if (!checkRateLimit(message.author.id)) {
            await message.reply('⏳ Rate limit exceeded. Please wait a moment before trying again.');
            return;
        }

        // Feature: Acknowledge message
        acknowledgeMessage(message).catch(err => log(`Failed to acknowledge DM: ${err}`));

        const content = message.content.trim();
        if (!content) return;

        // BRB/back detection for DM channels
        const dmChannelId = message.channel.id;
        if (isBrbMessage(content)) {
            setBrb(dmChannelId);
            await message.reply("👋 Got it — I'll send questions here when I need your input. Say **back** when you return.");
            return;
        }
        if (isBackMessage(content)) {
            setBack(dmChannelId);
            await message.reply('👋 Welcome back! Normal prompts from here.');
            return;
        }

        // Typed answer capture — if a pending typed answer exists for this DM channel,
        // store the user's message as the real response instead of queuing it
        if (pendingTypedAnswers.has(dmChannelId)) {
            const requestId = pendingTypedAnswers.get(dmChannelId)!;
            questionResponses.set(requestId, { answer: content, optionIndex: -1 });
            pendingTypedAnswers.delete(dmChannelId);
            await message.reply('✅ Answer received.');
            return;
        }

        log(`DM from ${message.author.tag}: ${content.slice(0, 80)}...`);

        // DMs use a synthetic "thread" ID based on the DM channel for session tracking.
        // Each DM channel maps 1:1 to a user, so channelId is the session key.

        // Look up existing session for this DM channel
        const mapping = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
            .get(dmChannelId) as { session_id: string; working_dir: string | null } | null;

        // Show typing indicator
        await (message.channel as DMChannel).sendTyping();

        if (mapping) {
            // Check session limits for ongoing DM session
            if (!checkSessionLimits(dmChannelId)) {
                await message.reply('⚠️ Session limit reached. Send `!reset` to start a new session.');
                return;
            }

            // Handle !reset to start fresh DM session
            if (content.toLowerCase() === '!reset') {
                db.run('DELETE FROM threads WHERE thread_id = ?', [dmChannelId]);
                await message.reply('🔄 Session reset. Your next message starts a new conversation.');
                return;
            }

            // Resume existing session
            const workingDir = mapping.working_dir ||
                process.env.CLAUDE_WORKING_DIR ||
                process.cwd();

            await claudeQueue.add('process', {
                prompt: content,
                threadId: dmChannelId,
                sessionId: mapping.session_id,
                resume: true,
                userId: message.author.id,
                username: message.author.tag,
                workingDir,
            });
        } else {
            // New DM session
            const sessionId = crypto.randomUUID();
            const { workingDir, cleanedMessage, error: workingDirError } = resolveWorkingDir(content, dmChannelId);

            if (workingDirError) {
                await message.reply(workingDirError);
                return;
            }

            // Store DM channel → session mapping
            db.run(
                'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
                [dmChannelId, sessionId, workingDir]
            );

            log(`New DM session ${sessionId} for ${message.author.tag}`);

            await claudeQueue.add('process', {
                prompt: cleanedMessage,
                threadId: dmChannelId,
                sessionId,
                resume: false,
                userId: message.author.id,
                username: message.author.tag,
                workingDir,
            });
        }

        return;
    }

    // Middleware: Check allowlist (users, roles, channels)
    if (!checkAllowlist(message)) {
        return; // Silently ignore messages from non-allowed users/channels
    }

    // Middleware: Check rate limits
    if (!checkRateLimit(message.author.id)) {
        await message.reply('⏳ Rate limit exceeded. Please wait a moment before trying again.');
        return;
    }

    // Feature: Handle pause/resume
    const pauseState = handlePauseResume(message);
    if (pauseState.paused) {
        // Message will be held in held_messages table
        return;
    }

    // Feature: Acknowledge message (fire and forget)
    acknowledgeMessage(message).catch(err => log(`Failed to acknowledge message: ${err}`));

    // Typed answer capture — if a pending typed answer exists for this channel,
    // store the user's message as the real response instead of normal processing.
    // This handles the "✏️ Type answer" flow from `tether ask` in regular channels.
    const channelId = message.channel.id;
    if (pendingTypedAnswers.has(channelId)) {
        const requestId = pendingTypedAnswers.get(channelId)!;
        const content = message.content.trim();
        if (content) {
            questionResponses.set(requestId, { answer: content, optionIndex: -1 });
            pendingTypedAnswers.delete(channelId);
            await message.reply('✅ Answer received.');
        }
        return;
    }

    const isMentioned = client.user && message.mentions.has(client.user);
    const isInThread = message.channel.isThread();

    // =========================================================================
    // THREAD MESSAGES: Continue existing conversations
    // =========================================================================
    if (isInThread) {
        const thread = message.channel;

        // Look up session ID and working dir for this thread
        const mapping = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
            .get(thread.id) as { session_id: string; working_dir: string | null } | null;

        if (!mapping) {
            // Not a thread we created, ignore
            return;
        }

        // Extract message content (strip @mentions)
        const threadContent = message.content.replace(/<@!?\d+>/g, '').trim();

        // BRB/back detection for threads
        if (isBrbMessage(threadContent)) {
            setBrb(thread.id);
            await message.reply("👋 Got it — I'll send questions here when I need your input. Say **back** when you return.");
            return;
        }
        if (isBackMessage(threadContent)) {
            setBack(thread.id);
            await message.reply('👋 Welcome back! Normal prompts from here.');
            return;
        }

        // Typed answer capture — if a pending typed answer exists for this thread,
        // store the user's message as the real response instead of queuing it
        if (pendingTypedAnswers.has(thread.id)) {
            const requestId = pendingTypedAnswers.get(thread.id)!;
            questionResponses.set(requestId, { answer: threadContent, optionIndex: -1 });
            pendingTypedAnswers.delete(thread.id);
            await message.reply('✅ Answer received.');
            return;
        }

        log(`Thread message from ${message.author.tag}`);

        // Show typing indicator
        await thread.sendTyping();

        // Use stored working dir or fall back to channel config / env / cwd
        const workingDir = mapping.working_dir ||
            getChannelConfigCached(thread.parentId || '')?.working_dir ||
            process.env.CLAUDE_WORKING_DIR ||
            process.cwd();

        // Queue for Claude processing with session resume
        await claudeQueue.add('process', {
            prompt: threadContent,
            threadId: thread.id,
            sessionId: mapping.session_id,
            resume: true,
            userId: message.author.id,
            username: message.author.tag,
            workingDir,
        });

        return;
    }

    // =========================================================================
    // NEW MENTIONS: Start new conversations
    // =========================================================================
    if (!isMentioned) return;

    log(`New mention from ${message.author.tag}`);

    // Extract message content and resolve working directory
    const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
    const { workingDir, cleanedMessage, error: workingDirError } = resolveWorkingDir(rawText, message.channelId);

    // If path override validation failed, reply with error
    if (workingDirError) {
        await message.reply(workingDirError);
        return;
    }

    log(`Working directory: ${workingDir}`);

    // Post status message in channel, then create thread from it
    // This allows us to update the status message later (Processing... → Done)
    let statusMessage;
    let thread;
    try {
        // Post status message in the channel
        statusMessage = await (message.channel as TextChannel).send('Processing...');

        // Generate thread name from cleaned message content
        const threadName = generateThreadName(cleanedMessage);

        // Create thread from the status message
        thread = await statusMessage.startThread({
            name: threadName,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        });

        // Feature: Get channel context for new conversations
        const channelContext = await getChannelContext(message.channel as TextChannel);
        if (channelContext) {
            log(`Channel context: ${channelContext.slice(0, 100)}...`);
        }

        // Copy the original message content into the thread for context
        // (excluding the bot mention and the status message)
        const originalMessages = await message.channel.messages.fetch({ limit: 10 });
        const userMessage = originalMessages.find(m => m.id === message.id);
        if (userMessage) {
            await thread.send(`**${message.author.tag}:** ${cleanedMessage}`);
        }
    } catch (error) {
        log(`Failed to create thread: ${error}`);
        await message.reply('Failed to start thread. Try again?');
        return;
    }

    // Generate a new session ID for this conversation
    const sessionId = crypto.randomUUID();

    // Feature: Check session limits before spawning
    if (!checkSessionLimits(thread.id)) {
        await thread.send('⚠️ Session limit reached. Please wait before starting a new conversation.');
        return;
    }

    // Store the thread → session mapping with working directory
    // Note: thread.id === statusMessage.id because thread was created from that message
    db.run(
        'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
        [thread.id, sessionId, workingDir]
    );

    log(`Created thread ${thread.id} with session ${sessionId}`);

    // Show typing indicator
    await thread.sendTyping();

    // Queue for Claude processing
    await claudeQueue.add('process', {
        prompt: cleanedMessage,
        threadId: thread.id,
        sessionId,
        resume: false,
        userId: message.author.id,
        username: message.author.tag,
        workingDir,
    });
});

// =========================================================================
// REACTION HANDLER: ✅ on last message marks thread as done
// =========================================================================
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    // Ignore bot reactions
    if (user.bot) return;

    // Only handle ✅ reactions
    if (reaction.emoji.name !== '✅') return;

    // Only handle reactions in threads
    const channel = reaction.message.channel;
    if (!channel.isThread()) return;

    try {
        const thread = channel;
        const parentChannelId = thread.parentId;
        if (!parentChannelId) return;

        // Check if this is the last message in the thread
        const messages = await thread.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();

        if (!lastMessage || lastMessage.id !== reaction.message.id) {
            // Reaction is not on the last message, ignore
            return;
        }

        log(`✅ reaction on last message in thread ${thread.id}`);

        // Update thread starter message to "Done"
        // The thread ID equals the starter message ID (thread was created from that message)
        const parentChannel = await client.channels.fetch(parentChannelId);
        if (parentChannel?.isTextBased()) {
            const starterMessage = await (parentChannel as TextChannel).messages.fetch(thread.id);
            await starterMessage.edit('✅ Done');
            log(`Thread ${thread.id} marked as Done`);
        }
    } catch (error) {
        log(`Failed to mark thread done: ${error}`);
    }
});

// Start the bot with exponential backoff
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error('DISCORD_BOT_TOKEN required');
    process.exit(1);
}

// Exponential backoff for Discord gateway connection (Issue #7)
async function connectWithBackoff() {
    let attempt = 0;
    let delay = 1000; // Start at 1 second
    const maxDelay = 30000; // Cap at 30 seconds

    while (true) {
        try {
            log(`Connecting to Discord gateway (attempt ${attempt + 1})...`);
            await client.login(token);
            break; // Connection successful
        } catch (error: any) {
            // Fatal errors - don't retry
            if (error.code === 'TokenInvalid' || 
                error.message?.includes('invalid token') ||
                error.message?.includes('Incorrect login') ||
                error.code === 'DisallowedIntents' ||
                error.message?.includes('intents')) {
                log(`Fatal error: ${error.message}`);
                process.exit(1);
            }

            // Transient errors - retry with backoff
            log(`Connection failed: ${error.message}`);
            attempt++;
            log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Exponential backoff: double the delay, cap at maxDelay
            delay = Math.min(delay * 2, maxDelay);
        }
    }
}

connectWithBackoff();

// Export for external use
export { client };
