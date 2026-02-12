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
    ForumChannel,
    Partials,
    ThreadAutoArchiveDuration,
    SlashCommandBuilder,
    type Interaction,
} from 'discord.js';
import { existsSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { claudeQueue } from './queue.js';
import {
    db,
    getChannelConfigCached,
    setChannelConfig,
    getProject,
    getDefaultProject,
    getChannelProject,
    getThreadProject,
    setThreadProject,
    listProjects as dbListProjects,
} from './db.js';
import type { Project } from './db.js';
import { migrateWorkingDirToProject } from './config.js';
import { startApiServer, buttonHandlers } from './api.js';
import { checkAllowlist } from './middleware/allowlist.js';
import { checkRateLimit } from './middleware/rate-limiter.js';
import { acknowledgeMessage } from './features/ack.js';
import { getChannelContext } from './features/channel-context.js';
import { generateThreadName } from './features/thread-naming.js';
import { checkSessionLimits } from './features/session-limits.js';
import { handlePauseResume } from './features/pause-resume.js';
import { isBrbMessage, isBackMessage, setBrb, setBack } from './features/brb.js';
import { listSessions, formatAge } from './features/sessions.js';
import {
    handleProjectAdd,
    handleProjectList,
    handleProjectDefault,
    handleProjectUse,
    handleSessionAttach,
    getRecentSessions,
} from './features/projects.js';
import { questionResponses, pendingTypedAnswers } from './api.js';

// DM support - opt-in via env var (disabled by default for security)
const ENABLE_DMS = process.env.ENABLE_DMS === 'true';

// Forum session support - create sessions as forum posts instead of text threads
const FORUM_SESSIONS = process.env.FORUM_SESSIONS === 'true';
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || '';

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

    // Check existence first (before realpath)
    if (!existsSync(resolved)) {
        return `Directory not found: \`${dir}\``;
    }

    // Resolve symlinks to prevent path traversal attacks
    let realPath: string;
    try {
        realPath = realpathSync(resolved);
    } catch (error) {
        return `Cannot resolve path: \`${dir}\` (${error instanceof Error ? error.message : String(error)})`;
    }

    // If no allowlist configured, path is valid (already checked existence)
    if (!ALLOWED_DIRS) {
        return null;
    }

    // Check against allowlist using real paths
    const isAllowed = ALLOWED_DIRS.some(allowed => {
        let allowedReal: string;
        try {
            allowedReal = realpathSync(allowed);
        } catch {
            // If allowed dir doesn't exist or can't be resolved, skip it
            return false;
        }
        return realPath === allowedReal || realPath.startsWith(allowedReal + '/');
    });

    if (!isAllowed) {
        return `Directory not in allowed list. Allowed: ${ALLOWED_DIRS.join(', ')}`;
    }

    return null;
}

// Force unbuffered logging
const log = (msg: string) => process.stdout.write(`[bot] ${msg}\n`);

/** Resolve default working directory with existence check. Falls back to cwd. */
function getDefaultWorkingDir(): string {
    // Check default project first
    const defaultProject = getDefaultProject();
    if (defaultProject && existsSync(defaultProject.path)) {
        return defaultProject.path;
    }

    // Fall back to env (deprecated)
    const envDir = process.env.CLAUDE_WORKING_DIR;
    if (envDir && existsSync(envDir)) return envDir;
    if (envDir) log(`WARNING: CLAUDE_WORKING_DIR="${envDir}" does not exist, using cwd`);
    return process.cwd();
}

// Helper function to redact message content in logs (preserves full content in DEBUG mode)
const redactContent = (content: string): string => {
    if (process.env.DEBUG === 'true') {
        return content;
    }
    return `[content:${content.length}chars]`;
};

/** Resolved project context from message + channel */
interface ResolvedProject {
    workingDir: string;
    projectName: string | null;
    cleanedMessage: string;
    error?: string;
}

/**
 * Resolve project context from a message and channel.
 *
 * Resolution order:
 * 1. [projectName] prefix → look up project by name
 * 2. [/path] prefix → backward compat with raw path syntax
 * 3. Channel's linked project (getChannelProject)
 * 4. Default project (getDefaultProject)
 * 5. Lazy migration from CLAUDE_WORKING_DIR → then check default again
 * 6. CLAUDE_WORKING_DIR env (deprecated)
 * 7. process.cwd() ("bot home" for simple questions)
 */
function resolveProject(message: string, channelId: string): ResolvedProject {
    const bracketMatch = message.match(/^\[([^\]]+)\]\s*/);
    if (bracketMatch && bracketMatch[1]) {
        const bracketValue = bracketMatch[1];
        const cleanedMessage = message.slice(bracketMatch[0].length);

        // 1. Check if it's a project name (not a path)
        if (!bracketValue.startsWith('/') && !bracketValue.startsWith('~') && !bracketValue.includes('\\')) {
            const project = getProject(bracketValue);
            if (project) {
                if (!existsSync(project.path)) {
                    return {
                        workingDir: '',
                        projectName: null,
                        cleanedMessage,
                        error: `Project "${bracketValue}" path not found: \`${project.path}\``,
                    };
                }
                return {
                    workingDir: project.path,
                    projectName: project.name,
                    cleanedMessage,
                };
            }
            // Not a known project name — fall through to path handling
            // (could be a relative path or typo; let validateWorkingDir handle it)
        }

        // 2. Backward compat: [/path] prefix
        let dir = bracketValue;
        if (dir.startsWith('~')) {
            dir = dir.replace('~', homedir());
        }
        const validationError = validateWorkingDir(dir);
        if (validationError) {
            return {
                workingDir: '',
                projectName: null,
                cleanedMessage,
                error: validationError,
            };
        }
        return {
            workingDir: resolve(dir),
            projectName: null,
            cleanedMessage,
        };
    }

    // 3. Check channel's linked project
    const channelProject = getChannelProject(channelId);
    if (channelProject) {
        if (existsSync(channelProject.path)) {
            return {
                workingDir: channelProject.path,
                projectName: channelProject.name,
                cleanedMessage: message,
            };
        }
        log(`WARNING: Channel project "${channelProject.name}" path not found: ${channelProject.path}`);
    }

    // 4. Check default project
    const defaultProject = getDefaultProject();
    if (defaultProject && existsSync(defaultProject.path)) {
        return {
            workingDir: defaultProject.path,
            projectName: defaultProject.name,
            cleanedMessage: message,
        };
    }

    // 5. Lazy migration: CLAUDE_WORKING_DIR → named project
    migrateWorkingDirToProject();
    const migratedDefault = getDefaultProject();
    if (migratedDefault && existsSync(migratedDefault.path)) {
        return {
            workingDir: migratedDefault.path,
            projectName: migratedDefault.name,
            cleanedMessage: message,
        };
    }

    // 6. Fall back to channel config (cached) — legacy behavior
    const channelConfig = getChannelConfigCached(channelId);
    if (channelConfig?.working_dir) {
        return {
            workingDir: channelConfig.working_dir,
            projectName: null,
            cleanedMessage: message,
        };
    }

    // 7. Fall back to CLAUDE_WORKING_DIR env (deprecated) or process.cwd()
    const envDir = process.env.CLAUDE_WORKING_DIR;
    if (envDir && existsSync(envDir)) {
        return {
            workingDir: envDir,
            projectName: null,
            cleanedMessage: message,
        };
    }

    // 8. Bot home — no project context (simple questions)
    return {
        workingDir: process.cwd(),
        projectName: null,
        cleanedMessage: message,
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

    // Always re-register to pick up new subcommands
    // Note: Discord.js doesn't allow mixing subcommand groups and standalone
    // subcommands, so we use groups for all logical areas.
    const command = new SlashCommandBuilder()
        .setName('cord')
        .setDescription('Configure Cord bot')
        .addSubcommandGroup(group =>
            group.setName('config')
                .setDescription('Bot configuration')
                .addSubcommand(sub =>
                    sub.setName('dir')
                       .setDescription('Set working directory for Claude in this channel')
                       .addStringOption(opt =>
                           opt.setName('path')
                              .setDescription('Working directory path')
                              .setRequired(true)
                       )
                )
        )
        .addSubcommandGroup(group =>
            group.setName('session')
                .setDescription('Session management')
                .addSubcommand(sub =>
                    sub.setName('list')
                       .setDescription('List resumable Claude Code sessions')
                       .addStringOption(opt =>
                           opt.setName('dir')
                              .setDescription('Project directory to list sessions for (defaults to channel config)')
                              .setRequired(false)
                       )
                       .addIntegerOption(opt =>
                           opt.setName('limit')
                              .setDescription('Max sessions to show (default 5)')
                              .setRequired(false)
                              .setMinValue(1)
                              .setMaxValue(25)
                       )
                )
                .addSubcommand(sub =>
                    sub.setName('attach')
                       .setDescription('Attach to an existing session in a new thread')
                       .addStringOption(opt =>
                           opt.setName('session')
                              .setDescription('Session ID to attach to')
                              .setRequired(true)
                              .setAutocomplete(true)
                       )
                )
        )
        .addSubcommandGroup(group =>
            group.setName('project')
                .setDescription('Project management')
                .addSubcommand(sub =>
                    sub.setName('add')
                       .setDescription('Register a new project')
                       .addStringOption(opt =>
                           opt.setName('name')
                              .setDescription('Short project name (e.g. my-app)')
                              .setRequired(true)
                       )
                       .addStringOption(opt =>
                           opt.setName('path')
                              .setDescription('Absolute path to project directory')
                              .setRequired(true)
                       )
                )
                .addSubcommand(sub =>
                    sub.setName('list')
                       .setDescription('List all registered projects')
                )
                .addSubcommand(sub =>
                    sub.setName('default')
                       .setDescription('Set a project as the global default')
                       .addStringOption(opt =>
                           opt.setName('name')
                              .setDescription('Project name')
                              .setRequired(true)
                              .setAutocomplete(true)
                       )
                )
                .addSubcommand(sub =>
                    sub.setName('use')
                       .setDescription('Set this channel\'s default project')
                       .addStringOption(opt =>
                           opt.setName('name')
                              .setDescription('Project name')
                              .setRequired(true)
                              .setAutocomplete(true)
                       )
                )
        );

    if (!cordCommand) {
        await c.application?.commands.create(command);
        log('Slash commands registered');
    } else {
        // Update existing command to include new subcommands
        await cordCommand.edit(command);
        log('Slash commands updated');
    }

    // Start HTTP API server
    const apiPort = parseInt(process.env.TETHER_API_PORT || '2643');
    startApiServer(client, apiPort);
});

// Handle slash command, autocomplete, and button interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // ── Autocomplete handler ──────────────────────────────────────────────
    if (interaction.isAutocomplete() && interaction.commandName === 'cord') {
        const focused = interaction.options.getFocused(true);

        if (focused.name === 'name') {
            // Autocomplete project names
            const projects = dbListProjects();
            const filtered = projects
                .filter(p => p.name.toLowerCase().includes(focused.value.toLowerCase()))
                .slice(0, 25);
            await interaction.respond(
                filtered.map(p => ({ name: `${p.name} (${p.path})`, value: p.name })),
            );
        }

        if (focused.name === 'session') {
            // Autocomplete session IDs from threads table
            const choices = getRecentSessions(focused.value);
            await interaction.respond(choices);
        }

        return;
    }

    // ── Slash command handler ─────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'cord') {
        const group = interaction.options.getSubcommandGroup();
        const subcommand = interaction.options.getSubcommand();

        // /cord config dir
        if (group === 'config' && subcommand === 'dir') {
            let dir = interaction.options.getString('path', true);

            // Expand ~ to home directory
            if (dir.startsWith('~')) {
                dir = dir.replace('~', homedir());
            }

            // Validate path against allowlist and check existence
            const validationError = validateWorkingDir(dir);
            if (validationError) {
                await interaction.reply({
                    content: validationError,
                    ephemeral: true,
                });
                return;
            }

            // Resolve to absolute path before storing
            dir = resolve(dir);

            setChannelConfig(interaction.channelId, dir);
            await interaction.reply({
                content: `Working directory set to \`${dir}\` for this channel.`,
                ephemeral: true,
            });
            log(`Channel ${interaction.channelId} configured with working dir: ${dir}`);
        }

        // /cord session list (was: /cord sessions)
        if (group === 'session' && subcommand === 'list') {
            // Resolve project directory: explicit option > channel config > env > cwd
            let projectDir = interaction.options.getString('dir');
            if (projectDir) {
                if (projectDir.startsWith('~')) {
                    projectDir = projectDir.replace('~', homedir());
                }
                projectDir = resolve(projectDir);
            } else {
                const channelConfig = getChannelConfigCached(interaction.channelId);
                projectDir = channelConfig?.working_dir
                    || getDefaultWorkingDir();
            }

            const limit = interaction.options.getInteger('limit') ?? 5;
            const sessions = listSessions(projectDir, limit);

            if (sessions.length === 0) {
                await interaction.reply({
                    content: `No Claude sessions found for \`${projectDir}\`.`,
                    ephemeral: true,
                });
                return;
            }

            // Format session list
            const lines = sessions.map((s, i) => {
                const age = formatAge(s.lastActivity);
                const preview = s.firstMessage
                    ? s.firstMessage.slice(0, 80) + (s.firstMessage.length > 80 ? '…' : '')
                    : '(no messages)';
                return `**${i + 1}.** \`${s.id.slice(0, 8)}…\` — ${age} ago, ${s.messageCount} msgs\n> ${preview}`;
            });

            await interaction.reply({
                content: `**Claude Sessions** for \`${projectDir}\`\n\n${lines.join('\n\n')}`,
                ephemeral: true,
            });
            log(`Listed ${sessions.length} sessions for ${projectDir}`);
        }

        // /cord session attach
        if (group === 'session' && subcommand === 'attach') {
            const sessionId = interaction.options.getString('session', true);
            const result = handleSessionAttach(sessionId);

            if (!result.success || !result.session) {
                await interaction.reply({ content: result.message, ephemeral: true });
                return;
            }

            // Create a new thread for the attached session
            try {
                const channel = interaction.channel;
                if (!channel || !('send' in channel)) {
                    await interaction.reply({ content: 'Cannot create thread in this channel.', ephemeral: true });
                    return;
                }

                const statusMessage = await (channel as TextChannel).send(
                    `Attaching to session \`${result.session.session_id.slice(0, 8)}...\``,
                );
                const thread = await statusMessage.startThread({
                    name: `Session ${result.session.session_id.slice(0, 8)}`,
                    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                });

                // Store the new thread → existing session mapping
                const workingDir = result.session.working_dir || getDefaultWorkingDir();
                db.run(
                    'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
                    [thread.id, result.session.session_id, workingDir],
                );

                await interaction.reply({
                    content: `Attached to session \`${result.session.session_id.slice(0, 8)}...\` in <#${thread.id}>`,
                    ephemeral: true,
                });
                log(`Attached session ${result.session.session_id} to new thread ${thread.id}`);
            } catch (error) {
                log(`Failed to attach session: ${error}`);
                await interaction.reply({ content: 'Failed to create thread for session.', ephemeral: true });
            }
        }

        // /cord project add
        if (group === 'project' && subcommand === 'add') {
            const name = interaction.options.getString('name', true);
            let path = interaction.options.getString('path', true);
            if (path.startsWith('~')) {
                path = path.replace('~', homedir());
            }
            const result = handleProjectAdd(name, path);
            await interaction.reply({ content: result.message, ephemeral: true });
        }

        // /cord project list
        if (group === 'project' && subcommand === 'list') {
            const { formatted } = handleProjectList();
            await interaction.reply({ content: formatted, ephemeral: true });
        }

        // /cord project default
        if (group === 'project' && subcommand === 'default') {
            const name = interaction.options.getString('name', true);
            const result = handleProjectDefault(name);
            await interaction.reply({ content: result.message, ephemeral: true });
        }

        // /cord project use
        if (group === 'project' && subcommand === 'use') {
            const name = interaction.options.getString('name', true);
            const result = handleProjectUse(interaction.channelId, name);
            await interaction.reply({ content: result.message, ephemeral: !result.success });
        }

        return;
    }

    if (!interaction.isButton()) return;

    log(`Looking up handler for: ${interaction.customId}`);
    log(`Available handlers: ${Array.from(buttonHandlers.keys()).join(', ') || 'none'}`);
    const handlerEntry = buttonHandlers.get(interaction.customId);
    if (!handlerEntry) {
        log(`No handler found for: ${interaction.customId}`);
        await interaction.reply({ content: 'This button has expired.', ephemeral: true });
        return;
    }

    const handler = handlerEntry.value;

    try {
        if (handler.type === 'inline') {
            await interaction.reply({
                content: handler.content,
                ephemeral: handler.ephemeral ?? false,
            });
        } else         if (handler.type === 'webhook') {
            await interaction.deferReply({ ephemeral: true });
            const webhookUrl = handler.url;
            if (!webhookUrl) {
                throw new Error('Webhook handler missing URL');
            }
            const response = await fetch(webhookUrl, {
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
            const requestIdEntry = pendingTypedAnswers.get(dmChannelId)!;
            const requestId = requestIdEntry.value;
            questionResponses.set(requestId, { value: { answer: content, optionIndex: -1 }, createdAt: Date.now() });
            pendingTypedAnswers.delete(dmChannelId);
            await message.reply('✅ Answer received.');
            return;
        }

        log(`DM from ${message.author.tag}: ${redactContent(content)}`);

        // DMs use a synthetic "thread" ID based on the DM channel for session tracking.
        // Each DM channel maps 1:1 to a user, so channelId is the session key.

        // Look up existing session for this DM channel
        const mapping = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
            .get(dmChannelId) as { session_id: string; working_dir: string | null } | null;

        // Show typing indicator
        await (message.channel as DMChannel).sendTyping();

        if (mapping) {
            // Handle !reset to start fresh DM session (BEFORE session limit check)
            if (content.toLowerCase() === '!reset') {
                db.run('DELETE FROM threads WHERE thread_id = ?', [dmChannelId]);
                await message.reply('🔄 Session reset. Your next message starts a new conversation.');
                return;
            }

            // Check session limits for ongoing DM session
            if (!checkSessionLimits(dmChannelId)) {
                await message.reply('⚠️ Session limit reached. Send `!reset` to start a new session.');
                return;
            }

            // Resume existing session — prefer thread project, then stored working_dir
            const threadProject = getThreadProject(dmChannelId);
            const workingDir = threadProject?.path ||
                mapping.working_dir ||
                getDefaultWorkingDir();

            await claudeQueue.add('process', {
                prompt: content,
                threadId: dmChannelId,
                sessionId: mapping.session_id,
                resume: true,
                userId: message.author.id,
                username: message.author.tag,
                workingDir,
                projectName: threadProject?.name,
            });
        } else {
            // New DM session
            const sessionId = crypto.randomUUID();
            const { workingDir, projectName, cleanedMessage, error: projectError } = resolveProject(content, dmChannelId);

            if (projectError) {
                await message.reply(projectError);
                return;
            }

            // Store DM channel → session mapping
            db.run(
                'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
                [dmChannelId, sessionId, workingDir]
            );

            // Link thread to project if resolved
            if (projectName) {
                setThreadProject(dmChannelId, projectName);
            }

            log(`New DM session ${sessionId} for ${message.author.tag}${projectName ? ` [project: ${projectName}]` : ''}`);

            await claudeQueue.add('process', {
                prompt: cleanedMessage,
                threadId: dmChannelId,
                sessionId,
                resume: false,
                userId: message.author.id,
                username: message.author.tag,
                workingDir,
                projectName: projectName ?? undefined,
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

    // =========================================================================
    // TEXT COMMANDS: !project add/list/default/use
    // =========================================================================
    if (message.content.startsWith('!project')) {
        const args = message.content.slice('!project'.length).trim().split(/\s+/);
        const subCmd = args[0];

        if (subCmd === 'add' && args[1] && args[2]) {
            let path = args.slice(2).join(' ');
            if (path.startsWith('~')) {
                path = path.replace('~', homedir());
            }
            const result = handleProjectAdd(args[1], path);
            await message.reply(result.message);
        } else if (subCmd === 'list') {
            const { formatted } = handleProjectList();
            await message.reply(formatted);
        } else if (subCmd === 'default' && args[1]) {
            const result = handleProjectDefault(args[1]);
            await message.reply(result.message);
        } else if (subCmd === 'use' && args[1]) {
            const result = handleProjectUse(message.channel.id, args[1]);
            await message.reply(result.message);
        } else {
            await message.reply(
                '**Usage:**\n' +
                '`!project add <name> <path>` — Register a project\n' +
                '`!project list` — List projects\n' +
                '`!project default <name>` — Set global default\n' +
                '`!project use <name>` — Set channel default',
            );
        }
        return;
    }

    // Feature: Handle pause/resume
    const pauseState = handlePauseResume(message);
    if (pauseState.paused) {
        // Message will be held in held_messages table
        return;
    }
    
    // If resumed, replay held messages
    if (pauseState.resumed) {
        const heldCount = pauseState.heldMessages?.length || 0;
        if (heldCount > 0) {
            await message.reply(`✅ Resuming — replaying ${heldCount} held message${heldCount !== 1 ? 's' : ''}...`);
            
            // Look up session for this thread
            const threadId = message.channel.id;
            const mapping = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
                .get(threadId) as { session_id: string; working_dir: string | null } | null;
            
            if (mapping) {
                // Resolve working dir: thread project > stored working_dir > channel config > default
                const threadProject = getThreadProject(threadId);
                const workingDir = threadProject?.path ||
                    mapping.working_dir ||
                    getChannelConfigCached(message.channel.isThread() ? message.channel.parentId || '' : '')?.working_dir ||
                    getDefaultWorkingDir();
                
                // Replay each held message in order
                for (const held of pauseState.heldMessages || []) {
                    await claudeQueue.add('process', {
                        prompt: held.content,
                        threadId,
                        sessionId: mapping.session_id,
                        resume: true,
                        userId: held.author_id,
                        username: 'held-message', // We don't have username stored
                        workingDir,
                    });
                }
            }
        } else {
            await message.reply('✅ Resumed (no held messages).');
        }
        return;
    }

    // Feature: Acknowledge message (fire and forget)
    acknowledgeMessage(message).catch(err => log(`Failed to acknowledge message: ${err}`));

    // Typed answer capture — if a pending typed answer exists for this channel,
    // store the user's message as the real response instead of normal processing.
    // This handles the "✏️ Type answer" flow from `tether ask` in regular channels.
    const channelId = message.channel.id;
    if (pendingTypedAnswers.has(channelId)) {
        const requestIdEntry = pendingTypedAnswers.get(channelId)!;
        const requestId = requestIdEntry.value;
        const content = message.content.trim();
        if (content) {
            questionResponses.set(requestId, { value: { answer: content, optionIndex: -1 }, createdAt: Date.now() });
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
            const requestIdEntry = pendingTypedAnswers.get(thread.id)!;
            const requestId = requestIdEntry.value;
            questionResponses.set(requestId, { value: { answer: threadContent, optionIndex: -1 }, createdAt: Date.now() });
            pendingTypedAnswers.delete(thread.id);
            await message.reply('✅ Answer received.');
            return;
        }

        log(`Thread message from ${message.author.tag}: ${redactContent(threadContent)}`);

        // Show typing indicator
        await thread.sendTyping();

        // Resolve working dir: thread project > stored working_dir > channel config > default
        const threadProject = getThreadProject(thread.id);
        const workingDir = threadProject?.path ||
            mapping.working_dir ||
            getChannelConfigCached(thread.parentId || '')?.working_dir ||
            getDefaultWorkingDir();

        // Queue for Claude processing with session resume
        await claudeQueue.add('process', {
            prompt: threadContent,
            threadId: thread.id,
            sessionId: mapping.session_id,
            resume: true,
            userId: message.author.id,
            username: message.author.tag,
            workingDir,
            projectName: threadProject?.name,
        });

        return;
    }

    // =========================================================================
    // NEW MENTIONS: Start new conversations
    // =========================================================================
    if (!isMentioned) return;

    // Extract message content and resolve project context
    const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
    log(`New mention from ${message.author.tag}: ${redactContent(rawText)}`);
    
    const { workingDir, projectName, cleanedMessage, error: projectError } = resolveProject(rawText, message.channelId);

    // If project/path resolution failed, reply with error
    if (projectError) {
        await message.reply(projectError);
        return;
    }

    log(`Working directory: ${workingDir}${projectName ? ` [project: ${projectName}]` : ''}`);

    // Post status message in channel, then create thread from it
    // This allows us to update the status message later (Processing... → Done)
    let statusMessage;
    let thread;
    let channelContext = '';
    try {
        if (FORUM_SESSIONS && FORUM_CHANNEL_ID) {
            // Forum mode: create a forum post in the configured forum channel
            const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID);
            if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
                log(`FORUM_CHANNEL_ID ${FORUM_CHANNEL_ID} is not a forum channel`);
                await message.reply('Forum channel is misconfigured. Check FORUM_CHANNEL_ID.');
                return;
            }

            const threadName = generateThreadName(cleanedMessage);

            // Forum posts require an initial message (unlike text threads)
            thread = await (forumChannel as ForumChannel).threads.create({
                name: threadName,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
                message: {
                    content: `**${message.author.tag}:** ${cleanedMessage}`,
                },
            });

            // Reply in the original channel with a link to the forum post
            await message.reply(`📋 Session started: <#${thread.id}>`);

            // Get context from the source channel (not the forum)
            channelContext = await getChannelContext(message.channel as TextChannel);
            if (channelContext) {
                log(`Channel context: ${redactContent(channelContext)}`);
            }
        } else {
            // Default mode: create a text thread from a status message
            statusMessage = await (message.channel as TextChannel).send('Processing...');

            const threadName = generateThreadName(cleanedMessage);

            thread = await statusMessage.startThread({
                name: threadName,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
            });

            // Feature: Get channel context for new conversations
            channelContext = await getChannelContext(message.channel as TextChannel);
            if (channelContext) {
                log(`Channel context: ${redactContent(channelContext)}`);
            }

            // Copy the original message content into the thread for context
            const originalMessages = await message.channel.messages.fetch({ limit: 10 });
            const userMessage = originalMessages.find(m => m.id === message.id);
            if (userMessage) {
                await thread.send(`**${message.author.tag}:** ${cleanedMessage}`);
            }
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

    // Link thread to project if resolved
    if (projectName) {
        setThreadProject(thread.id, projectName);
    }

    log(`Created thread ${thread.id} with session ${sessionId}${projectName ? ` [project: ${projectName}]` : ''}`);

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
        projectName: projectName ?? undefined,
        channelContext,
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

        // Determine parent channel type for the correct "Done" update
        const parentChannel = await client.channels.fetch(parentChannelId);

        if (parentChannel?.type === ChannelType.GuildForum) {
            // Forum thread: edit the starter message inside the thread
            try {
                const starterMessage = await thread.fetchStarterMessage();
                if (starterMessage) {
                    await starterMessage.edit(`${starterMessage.content}\n\n✅ Done`);
                    log(`Forum thread ${thread.id} marked as Done`);
                }
            } catch (error) {
                log(`Failed to edit forum starter message: ${error}`);
            }
        } else if (parentChannel?.isTextBased()) {
            // Text thread: edit the status message in the parent channel
            // The thread ID equals the starter message ID (thread was created from that message)
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

// Graceful shutdown handlers
process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', () => {
    log('SIGINT received, shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

// Export for external use
export { client };
