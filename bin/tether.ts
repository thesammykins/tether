#!/usr/bin/env bun
/**
 * Tether CLI - Manage your Discord-AI Agent bridge
 *
 * Management Commands:
 *   tether start   - Start bot and worker
 *   tether stop    - Stop all processes
 *   tether status  - Show running status
 *   tether health  - Check Distether connection
 *   tether setup   - Interactive setup wizard
 *   tether config  - Manage configuration and encrypted secrets
 *
 * Distether Commands:
 *   tether send <channel> "message"
 *   tether embed <channel> "description" [--title, --color, --field, etc.]
 *   tether file <channel> <filepath> "message"
 *   tether buttons <channel> "prompt" --button label="..." id="..." [style, reply, webhook]
 *   tether ask <channel> "question" --option "A" --option "B" [--timeout 300]
 *   tether typing <channel>
 *   tether edit <channel> <messageId> "content"
 *   tether delete <channel> <messageId>
 *   tether rename <threadId> "name"
 *   tether reply <channel> <messageId> "message"
 *   tether thread <channel> <messageId> "name"
 *   tether react <channel> <messageId> "emoji"
 *   tether state <channel> <messageId> <state>  (processing, done, error, or custom)
 *
 * DM Commands:
 *   tether dm <user-id> "message"
 *   tether dm <user-id> --embed "description" [--title, --color, --field, etc.]
 *   tether dm <user-id> --file <filepath> ["message"]
 */

import { spawn, spawnSync } from 'bun';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, symlinkSync, lstatSync, readlinkSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import * as readline from 'readline';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import {
    ensureConfigDir, readPreferences, writePreference, readSecrets, writeSecret,
    deleteKey as deleteConfigKey, resolve as resolveConfig, resolveAll,
    isKnownKey, isSecret, getKeyMeta, getKnownKeys, hasSecrets, hasConfig,
    importDotEnv, CONFIG_PATHS,
} from '../src/config.js';

const PID_FILE = join(process.cwd(), '.tether.pid');
const API_BASE = process.env.TETHER_API_URL || 'http://localhost:2643';

const command = process.argv[2];
const args = process.argv.slice(3);

// Color name to Distether color int mapping
const COLORS: Record<string, number> = {
    red: 15158332,      // 0xE74C3C
    green: 3066993,     // 0x2ECC71
    blue: 3447003,      // 0x3498DB
    yellow: 16776960,   // 0xFFFF00
    purple: 10181046,   // 0x9B59B6
    orange: 15105570,   // 0xE67E22
    gray: 9807270,      // 0x95A5A6
    grey: 9807270,      // 0x95A5A6
};

// Button style name to Distether style int mapping
const BUTTON_STYLES: Record<string, number> = {
    primary: 1,
    secondary: 2,
    success: 3,
    danger: 4,
};

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// ============ API Helper ============

/**
 * Build standard API headers including Authorization if API_TOKEN is set.
 * All API routes except /health require auth when API_TOKEN is configured.
 */
function buildApiHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.API_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.API_TOKEN}`;
    }
    return headers;
}

async function apiCall(endpoint: string, body: any): Promise<any> {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: buildApiHeaders(),
            body: JSON.stringify(body),
        });
        const data = await response.json() as Record<string, unknown>;
        if (!response.ok || data.error) {
            console.error('Error:', data.error || 'Request failed');
            process.exit(1);
        }
        return data;
    } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
            console.error('Error: Cannot connect to Tether API. Is the bot running? (tether start)');
        } else {
            console.error('Error:', error.message);
        }
        process.exit(1);
    }
}

// ============ Distether Commands ============

async function sendMessage() {
    const channel = args[0];
    const message = args[1];
    if (!channel || !message) {
        console.error('Usage: tether send <channel> "message"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'send-to-thread',
        args: { thread: channel, message },
    });
    console.log(`Sent message: ${result.messageId}`);
}

async function sendEmbed() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: tether embed <channel> "description" [--title "..." --color green ...]');
        process.exit(1);
    }

    // Parse flags and find positional description
    const embed: any = {};
    const fields: any[] = [];
    let description = '';
    let i = 1;

    while (i < args.length) {
        const arg = args[i];
        if (arg === '--title' && args[i + 1]) {
            embed.title = args[++i];
        } else if (arg === '--url' && args[i + 1]) {
            embed.url = args[++i];
        } else if (arg === '--color' && args[i + 1]) {
            const colorArg = args[++i]!.toLowerCase();
            embed.color = COLORS[colorArg] || parseInt(colorArg.replace('0x', ''), 16) || 0;
        } else if (arg === '--author' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.name = args[++i];
        } else if (arg === '--author-url' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.url = args[++i];
        } else if (arg === '--author-icon' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.icon_url = args[++i];
        } else if (arg === '--thumbnail' && args[i + 1]) {
            embed.thumbnail = { url: args[++i] };
        } else if (arg === '--image' && args[i + 1]) {
            embed.image = { url: args[++i] };
        } else if (arg === '--footer' && args[i + 1]) {
            embed.footer = embed.footer || {};
            embed.footer.text = args[++i];
        } else if (arg === '--footer-icon' && args[i + 1]) {
            embed.footer = embed.footer || {};
            embed.footer.icon_url = args[++i];
        } else if (arg === '--timestamp') {
            embed.timestamp = new Date().toISOString();
        } else if (arg === '--field' && args[i + 1]) {
            const fieldStr = args[++i]!;
            const parts = fieldStr.split(':');
            if (parts.length >= 2) {
                fields.push({
                    name: parts[0],
                    value: parts[1],
                    inline: parts[2]?.toLowerCase() === 'inline',
                });
            }
        } else if (arg && !arg.startsWith('--')) {
            description = arg;
        }
        i++;
    }

    if (description) embed.description = description;
    if (fields.length > 0) embed.fields = fields;

    const result = await apiCall('/command', {
        command: 'send-to-thread',
        args: { thread: channel, embeds: [embed] },
    });
    console.log(`Sent embed: ${result.messageId}`);
}

async function sendFile() {
    const channel = args[0];
    const filepath = args[1];
    const message = args[2] || '';

    if (!channel || !filepath) {
        console.error('Usage: tether file <channel> <filepath> ["message"]');
        process.exit(1);
    }

    if (!existsSync(filepath)) {
        console.error(`Error: File not found: ${filepath}`);
        process.exit(1);
    }

    const fileContent = readFileSync(filepath, 'utf-8');
    const fileName = filepath.split('/').pop() || 'file.txt';

    const result = await apiCall('/send-with-file', {
        channelId: channel,
        fileName,
        fileContent,
        content: message,
    });
    console.log(`Sent file: ${result.messageId}`);
}

async function sendButtons() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: tether buttons <channel> "prompt" --button label="..." id="..." [style="success"] [reply="..."] [webhook="..."]');
        process.exit(1);
    }

    let promptText = '';
    const buttons: any[] = [];
    let i = 1;

    while (i < args.length) {
        const arg = args[i];
        if (arg === '--button') {
            // Collect all following key=value pairs until next flag or end
            const button: any = {};
            i++;
            while (i < args.length && !args[i]!.startsWith('--')) {
                const kvMatch = args[i]!.match(/^(\w+)=(.*)$/);
                if (kvMatch) {
                    const [, key, value] = kvMatch;
                    if (key === 'style') {
                        button.style = BUTTON_STYLES[value!.toLowerCase()] || 1;
                    } else {
                        button[key!] = value;
                    }
                }
                i++;
            }
            if (button.label && button.id) {
                // Convert to API format
                const apiButton: any = {
                    label: button.label,
                    customId: button.id,
                    style: button.style || 1,
                };
                if (button.reply || button.webhook) {
                    apiButton.handler = {};
                    if (button.reply) {
                        apiButton.handler.type = 'inline';
                        apiButton.handler.content = button.reply;
                        apiButton.handler.ephemeral = true;
                    }
                    if (button.webhook) {
                        apiButton.handler.type = button.reply ? 'inline' : 'webhook';
                        apiButton.handler.webhookUrl = button.webhook;
                    }
                }
                buttons.push(apiButton);
            }
            continue; // Don't increment i again
        } else if (arg && !arg.startsWith('--')) {
            promptText = arg;
        }
        i++;
    }

    if (buttons.length === 0) {
        console.error('Error: At least one --button is required');
        process.exit(1);
    }

    const result = await apiCall('/send-with-buttons', {
        channelId: channel,
        content: promptText,
        buttons,
    });
    console.log(`Sent buttons: ${result.messageId}`);
}

async function askQuestion() {
    const channel = args[0];
    const questionText = args[1];

    if (!channel || !questionText) {
        console.error('Usage: tether ask <channelId> "question text" --option "Option A" --option "Option B" [--timeout 300]');
        process.exit(1);
    }

    // Parse options and timeout
    const options: string[] = [];
    let timeout = 300; // Default 300 seconds (5 minutes)
    let i = 2;

    while (i < args.length) {
        const arg = args[i];
        if (arg === '--option' && args[i + 1]) {
            options.push(args[i + 1]!);
            i += 2;
        } else if (arg === '--timeout' && args[i + 1]) {
            timeout = parseInt(args[i + 1]!, 10);
            if (isNaN(timeout) || timeout <= 0) {
                console.error('Error: --timeout must be a positive number');
                process.exit(1);
            }
            i += 2;
        } else {
            i++;
        }
    }

    if (options.length === 0) {
        console.error('Error: At least one --option is required');
        process.exit(1);
    }

    // Generate unique request ID
    const requestId = randomUUID();
    const API_PORT = process.env.TETHER_API_PORT ? parseInt(process.env.TETHER_API_PORT) : 2643;

    // Build buttons array: one per option + "Type answer" button
    const buttons = options.map((label, index) => ({
        label,
        customId: `ask_${requestId}_${index}`,
        style: 'primary',
        handler: {
            type: 'webhook',
            url: `http://localhost:${API_PORT}/question-response/${requestId}`,
            data: {
                option: label,
                optionIndex: index,
            },
        },
    }));

    // Add "Type answer" button
    buttons.push({
        label: '✏️ Type answer',
        customId: `ask_${requestId}_type`,
        style: 'secondary',
        handler: {
            type: 'webhook',
            url: `http://localhost:${API_PORT}/question-response/${requestId}`,
            data: {
                option: '__type__',
                optionIndex: -1,
                threadId: channel,
            },
        },
    } as any);

    // Send buttons message
    try {
        await apiCall('/send-with-buttons', {
            channelId: channel,
            content: questionText,
            buttons,
        });
    } catch (error) {
        console.error('Failed to send question message');
        process.exit(1);
    }

    // Poll for response
    const pollInterval = 2000; // 2 seconds
    const maxAttempts = Math.ceil((timeout * 1000) / pollInterval);
    let attempts = 0;

    while (attempts < maxAttempts) {
        try {
            const response = await fetch(`http://localhost:${API_PORT}/question-response/${requestId}`, {
                headers: buildApiHeaders(),
            });
            
            if (response.status === 404) {
                // Not yet registered or answered, keep polling
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                attempts++;
                continue;
            }

            if (response.ok) {
                const data = await response.json() as { answered: boolean; answer?: string; optionIndex?: number };
                
                if (data.answered) {
                    if (data.answer === '__type__') {
                        // User clicked "Type answer" - keep polling for typed response
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                        attempts++;
                        continue;
                    }
                    
                    // Got a real answer
                    console.log(data.answer);
                    process.exit(0);
                }
            }
        } catch (error) {
            // Network error, keep trying
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
    }

    // Timeout
    console.error('No response received');
    process.exit(1);
}

async function startTyping() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: tether typing <channel>');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'start-typing',
        args: { channel },
    });
    console.log('Typing indicator sent');
}

async function editMessage() {
    const channel = args[0];
    const messageId = args[1];
    const content = args[2];
    if (!channel || !messageId || !content) {
        console.error('Usage: tether edit <channel> <messageId> "new content"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'edit-message',
        args: { channel, message: messageId, content },
    });
    console.log(`Edited message: ${messageId}`);
}

async function deleteMessage() {
    const channel = args[0];
    const messageId = args[1];
    if (!channel || !messageId) {
        console.error('Usage: tether delete <channel> <messageId>');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'delete-message',
        args: { channel, message: messageId },
    });
    console.log(`Deleted message: ${messageId}`);
}

async function renameThread() {
    const threadId = args[0];
    const name = args[1];
    if (!threadId || !name) {
        console.error('Usage: tether rename <threadId> "new name"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'rename-thread',
        args: { thread: threadId, name },
    });
    console.log(`Renamed thread: ${threadId}`);
}

async function replyToMessage() {
    const channel = args[0];
    const messageId = args[1];
    const message = args[2];
    if (!channel || !messageId || !message) {
        console.error('Usage: tether reply <channel> <messageId> "message"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'reply-to-message',
        args: { channel, message: messageId, content: message },
    });
    console.log(`Replied to message: ${result.messageId}`);
}

async function createThread() {
    const channel = args[0];
    const messageId = args[1];
    const name = args[2];
    if (!channel || !messageId || !name) {
        console.error('Usage: tether thread <channel> <messageId> "thread name"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'create-thread',
        args: { channel, message: messageId, name },
    });
    console.log(`Created thread: ${result.threadId}`);
}

async function addReaction() {
    const channel = args[0];
    const messageId = args[1];
    const emoji = args[2];
    if (!channel || !messageId || !emoji) {
        console.error('Usage: tether react <channel> <messageId> "emoji"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'add-reaction',
        args: { channel, message: messageId, emoji },
    });
    console.log(`Added reaction: ${emoji}`);
}

async function sendDM() {
    const userId = args[0];
    if (!userId) {
        console.error('Usage: tether dm <user-id> "message"');
        console.error('       tether dm <user-id> --embed "description" [--title, --color, ...]');
        console.error('       tether dm <user-id> --file <filepath> ["message"]');
        process.exit(1);
    }

    const subArgs = args.slice(1);

    // --file mode: tether dm <user-id> --file <path> ["message"]
    if (subArgs[0] === '--file') {
        const filepath = subArgs[1];
        const message = subArgs[2] || '';

        if (!filepath) {
            console.error('Usage: tether dm <user-id> --file <filepath> ["message"]');
            process.exit(1);
        }

        if (!existsSync(filepath)) {
            console.error(`Error: File not found: ${filepath}`);
            process.exit(1);
        }

        const fileContent = readFileSync(filepath, 'utf-8');
        const fileName = filepath.split('/').pop() || 'file.txt';

        const result = await apiCall('/send-dm-file', {
            userId,
            fileName,
            fileContent,
            content: message,
        });
        console.log(`DM file sent: ${result.messageId}`);
        return;
    }

    // --embed mode: tether dm <user-id> --embed "description" [--title, --color, ...]
    if (subArgs[0] === '--embed') {
        const embed: any = {};
        const fields: any[] = [];
        let description = '';
        let i = 1;

        while (i < subArgs.length) {
            const arg = subArgs[i];
            if (arg === '--title' && subArgs[i + 1]) {
                embed.title = subArgs[++i];
            } else if (arg === '--color' && subArgs[i + 1]) {
                const colorArg = subArgs[++i]!.toLowerCase();
                embed.color = COLORS[colorArg] || parseInt(colorArg.replace('0x', ''), 16) || 0;
            } else if (arg === '--footer' && subArgs[i + 1]) {
                embed.footer = { text: subArgs[++i] };
            } else if (arg === '--field' && subArgs[i + 1]) {
                const fieldStr = subArgs[++i]!;
                const parts = fieldStr.split(':');
                if (parts.length >= 2) {
                    fields.push({
                        name: parts[0],
                        value: parts[1],
                        inline: parts[2]?.toLowerCase() === 'inline',
                    });
                }
            } else if (arg === '--timestamp') {
                embed.timestamp = new Date().toISOString();
            } else if (arg && !arg.startsWith('--')) {
                description = arg;
            }
            i++;
        }

        if (description) embed.description = description;
        if (fields.length > 0) embed.fields = fields;

        const result = await apiCall('/command', {
            command: 'send-dm',
            args: { userId, embeds: [embed] },
        });
        console.log(`DM embed sent: ${result.messageId}`);
        return;
    }

    // Default: text message — tether dm <user-id> "message"
    const message = subArgs[0];
    if (!message) {
        console.error('Usage: tether dm <user-id> "message"');
        process.exit(1);
    }

    const result = await apiCall('/command', {
        command: 'send-dm',
        args: { userId, message },
    });
    console.log(`DM sent: ${result.messageId}`);
}

// State presets for thread status updates
const STATE_PRESETS: Record<string, string> = {
    processing: '🤖 Processing...',
    thinking: '🧠 Thinking...',
    searching: '🔍 Searching...',
    writing: '✍️ Writing...',
    done: '✅ Done',
    error: '❌ Something went wrong',
    waiting: '⏳ Waiting for input...',
};

async function updateState() {
    const channel = args[0];
    const messageId = args[1];
    const stateOrCustom = args[2];

    if (!channel || !messageId || !stateOrCustom) {
        console.error('Usage: tether state <channel> <messageId> <state>');
        console.error('');
        console.error('Preset states:');
        console.error('  processing  - 🤖 Processing...');
        console.error('  thinking    - 🧠 Thinking...');
        console.error('  searching   - 🔍 Searching...');
        console.error('  writing     - ✍️ Writing...');
        console.error('  done        - ✅ Done');
        console.error('  error       - ❌ Something went wrong');
        console.error('  waiting     - ⏳ Waiting for input...');
        console.error('');
        console.error('Or use custom text: tether state <channel> <messageId> "Custom status"');
        process.exit(1);
    }

    const content = STATE_PRESETS[stateOrCustom.toLowerCase()] || stateOrCustom;

    await apiCall('/command', {
        command: 'edit-message',
        args: { channel, message: messageId, content },
    });
    console.log(`Updated state: ${content}`);
}

// ============ Management Commands ============

async function projectCommand() {
    const subcommand = args[0];
    const API_PORT = process.env.TETHER_API_PORT ? parseInt(process.env.TETHER_API_PORT) : 2643;

    switch (subcommand) {
        case 'add': {
            const name = args[1];
            const rawPath = args[2];
            if (!name || !rawPath) {
                console.error('Usage: tether project add <name> <path>');
                process.exit(1);
            }

            const { resolve: resolvePath } = await import('path');
            const resolvedPath = resolvePath(rawPath);

            if (!existsSync(resolvedPath)) {
                console.error(`Error: Path does not exist: ${resolvedPath}`);
                process.exit(1);
            }

            try {
                const response = await fetch(`${API_BASE}/projects`, {
                    method: 'POST',
                    headers: buildApiHeaders(),
                    body: JSON.stringify({ name, path: resolvedPath }),
                });
                const data = await response.json() as Record<string, unknown>;
                if (!response.ok || data.error) {
                    console.error('Error:', data.error || 'Request failed');
                    process.exit(1);
                }
                console.log(`Project "${name}" added: ${resolvedPath}`);
            } catch (error: unknown) {
                const err = error as { code?: string; message?: string };
                if (err.code === 'ECONNREFUSED') {
                    console.error('Error: Cannot connect to Tether API. Is the bot running? (tether start)');
                } else {
                    console.error('Error:', err.message);
                }
                process.exit(1);
            }
            break;
        }

        case 'list': {
            try {
                const response = await fetch(`${API_BASE}/projects`, {
                    headers: buildApiHeaders(),
                });
                const projects = await response.json() as Array<{
                    name: string;
                    path: string;
                    is_default: number;
                }>;
                if (!response.ok) {
                    console.error('Error: Failed to list projects');
                    process.exit(1);
                }
                if (projects.length === 0) {
                    console.log('No projects registered. Add one with: tether project add <name> <path>');
                    return;
                }
                console.log('\nProjects:\n');
                for (const p of projects) {
                    const marker = p.is_default ? ' (default)' : '';
                    console.log(`  ${p.name}${marker}`);
                    console.log(`    ${p.path}\n`);
                }
            } catch (error: unknown) {
                const err = error as { code?: string; message?: string };
                if (err.code === 'ECONNREFUSED') {
                    console.error('Error: Cannot connect to Tether API. Is the bot running? (tether start)');
                } else {
                    console.error('Error:', err.message);
                }
                process.exit(1);
            }
            break;
        }

        case 'remove': {
            const name = args[1];
            if (!name) {
                console.error('Usage: tether project remove <name>');
                process.exit(1);
            }

            try {
                const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}`, {
                    method: 'DELETE',
                    headers: buildApiHeaders(),
                });
                const data = await response.json() as Record<string, unknown>;
                if (!response.ok || data.error) {
                    console.error('Error:', data.error || 'Request failed');
                    process.exit(1);
                }
                console.log(`Project "${name}" removed.`);
            } catch (error: unknown) {
                const err = error as { code?: string; message?: string };
                if (err.code === 'ECONNREFUSED') {
                    console.error('Error: Cannot connect to Tether API. Is the bot running? (tether start)');
                } else {
                    console.error('Error:', err.message);
                }
                process.exit(1);
            }
            break;
        }

        case 'set-default': {
            const name = args[1];
            if (!name) {
                console.error('Usage: tether project set-default <name>');
                process.exit(1);
            }

            try {
                const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/default`, {
                    method: 'POST',
                    headers: buildApiHeaders(),
                });
                const data = await response.json() as Record<string, unknown>;
                if (!response.ok || data.error) {
                    console.error('Error:', data.error || 'Request failed');
                    process.exit(1);
                }
                console.log(`Project "${name}" set as default.`);
            } catch (error: unknown) {
                const err = error as { code?: string; message?: string };
                if (err.code === 'ECONNREFUSED') {
                    console.error('Error: Cannot connect to Tether API. Is the bot running? (tether start)');
                } else {
                    console.error('Error:', err.message);
                }
                process.exit(1);
            }
            break;
        }

        default:
            console.log(`
Usage: tether project <subcommand>

Subcommands:
  add <name> <path>       Register a project (validates path exists)
  list                    List all registered projects
  remove <name>           Remove a project
  set-default <name>      Set a project as the default
`);
            if (subcommand) {
                console.error(`Unknown project subcommand: ${subcommand}`);
                process.exit(1);
            }
            break;
    }
}

async function setup() {
    console.log('\n🔌 Tether Setup\n');

    // Check for .env
    const envPath = join(process.cwd(), '.env');
    const envExamplePath = join(process.cwd(), '.env.example');

    if (existsSync(envPath)) {
        console.log('✓ .env file exists');
    } else if (existsSync(envExamplePath)) {
        console.log('Creating .env from .env.example...\n');

        const token = await prompt('Distether Bot Token: ');
        if (!token) {
            console.log('Token required. Run setup again when ready.');
            process.exit(1);
        }

        const tz = await prompt('Timezone (default: America/New_York): ') || 'America/New_York';

        let envContent = readFileSync(envExamplePath, 'utf-8');
        envContent = envContent.replace('your-bot-token-here', token);
        envContent = envContent.replace('TZ=America/New_York', `TZ=${tz}`);

        writeFileSync(envPath, envContent);
        console.log('\n✓ .env file created');
    }

    // Check Redis
    const redis = spawnSync(['redis-cli', 'ping'], { stdout: 'pipe', stderr: 'pipe' });
    if (redis.exitCode === 0) {
        console.log('✓ Redis is running');
    } else {
        console.log('⚠ Redis not running. Start it with: redis-server');
    }

    // Check Agent CLI based on TETHER_AGENT env var
    const agentType = process.env.TETHER_AGENT || 'claude';
    let agentBinary: string;
    let agentInstallUrl: string;
    
    switch (agentType) {
        case 'claude-code':
        case 'claude':
            agentBinary = 'claude';
            agentInstallUrl = 'https://claude.ai/code';
            break;
        case 'opencode':
            agentBinary = 'opencode';
            agentInstallUrl = 'https://github.com/getcursor/opencode';
            break;
        case 'codex-cli':
        case 'codex':
            agentBinary = 'codex';
            agentInstallUrl = 'https://github.com/getcursor/codex';
            break;
        default:
            agentBinary = agentType;
            agentInstallUrl = '(unknown agent type)';
    }
    
    const agentCheck = spawnSync([agentBinary, '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (agentCheck.exitCode === 0) {
        console.log(`✓ ${agentBinary} CLI installed`);
    } else {
        console.log(`⚠ ${agentBinary} CLI not found. Install from: ${agentInstallUrl}`);
    }

    // Install Tether skill for agent (legacy Claude Code location)
    const legacySkillsDir = join(homedir(), '.claude', 'skills', 'tether');
    const tetherRoot = dirname(import.meta.dir);
    const sourceSkillsDir = join(tetherRoot, 'skills', 'tether');

    if (existsSync(sourceSkillsDir)) {
        console.log('\n📚 Tether Skill (Legacy Claude Code location)');
        console.log('   Teaches your assistant how to send Discord messages, embeds,');
        console.log('   files, and interactive buttons.');
        const installSkill = await prompt('Install skill to ~/.claude/skills/tether? (Y/n): ');
        if (installSkill.toLowerCase() !== 'n') {
            mkdirSync(legacySkillsDir, { recursive: true });
            cpSync(sourceSkillsDir, legacySkillsDir, { recursive: true });
            console.log(`✓ Skill installed to ${legacySkillsDir}`);
        }
    }

    // Symlink skill to standard location (~/.agents/skills/tether)
    const standardSkillsDir = join(homedir(), '.agents', 'skills', 'tether');
    
    if (existsSync(sourceSkillsDir)) {
        console.log('\n📚 Tether Skill (Standard location for all agents)');
        console.log('   Symlinking to ~/.agents/skills/tether for OpenCode, Codex, etc.');
        
        // Create ~/.agents/skills/ if it doesn't exist
        mkdirSync(join(homedir(), '.agents', 'skills'), { recursive: true });
        
        // Check if symlink already exists
        let shouldCreateSymlink = true;
        if (existsSync(standardSkillsDir)) {
            try {
                const stats = lstatSync(standardSkillsDir);
                if (stats.isSymbolicLink()) {
                    const target = readlinkSync(standardSkillsDir);
                    if (target === sourceSkillsDir) {
                        console.log(`✓ Symlink already exists and points to correct location`);
                        shouldCreateSymlink = false;
                    } else {
                        console.log(`⚠ Symlink exists but points to: ${target}`);
                        const overwrite = await prompt('Overwrite? (Y/n): ');
                        if (overwrite.toLowerCase() !== 'n') {
                            unlinkSync(standardSkillsDir);
                        } else {
                            shouldCreateSymlink = false;
                        }
                    }
                } else {
                    console.log(`⚠ ${standardSkillsDir} exists but is not a symlink`);
                    const overwrite = await prompt('Remove and create symlink? (Y/n): ');
                    if (overwrite.toLowerCase() !== 'n') {
                        unlinkSync(standardSkillsDir);
                    } else {
                        shouldCreateSymlink = false;
                    }
                }
            } catch (err) {
                console.log(`⚠ Error checking existing path: ${err}`);
                shouldCreateSymlink = false;
            }
        }
        
        if (shouldCreateSymlink) {
            try {
                symlinkSync(sourceSkillsDir, standardSkillsDir, 'dir');
                console.log(`✓ Symlinked ${standardSkillsDir} → ${sourceSkillsDir}`);
            } catch (err) {
                console.log(`⚠ Failed to create symlink: ${err}`);
            }
        }
    }

    console.log('\n✨ Setup complete! Run: tether start\n');
}

async function start() {
    if (existsSync(PID_FILE)) {
        console.log('Tether is already running. Run: tether stop');
        process.exit(1);
    }

    // Parse debug flag
    const debugMode = args.includes('--debug') || args.includes('--verbose');

    console.log('Starting Tether...\n');

    // Resolve script paths relative to the package root, not process.cwd().
    // When installed globally or via npx, cwd is the user's project dir where
    // src/bot.ts doesn't exist. import.meta.dir is bin/, so one level up is root.
    const packageRoot = dirname(import.meta.dir);
    const botScript = join(packageRoot, 'src', 'bot.ts');
    const workerScript = join(packageRoot, 'src', 'worker.ts');

    // Load config store values into child process environment.
    // Secrets are encrypted on disk — decrypt them so bot/worker can read
    // DISCORD_BOT_TOKEN etc. from process.env as they expect.
    const childEnv: Record<string, string | undefined> = { ...process.env };
    const prefs = readPreferences();
    for (const [key, value] of Object.entries(prefs)) {
        if (!childEnv[key]) childEnv[key] = value;
    }
    if (hasSecrets()) {
        const pw = await promptPassword('Encryption password: ');
        try {
            const secrets = readSecrets(pw);
            for (const [key, value] of Object.entries(secrets)) {
                if (!childEnv[key]) childEnv[key] = value;
            }
        } catch {
            console.error('Wrong password or corrupted secrets file.');
            process.exit(1);
        }
    }

    // Enable debug mode in child processes
    if (debugMode) {
        childEnv.TETHER_DEBUG = 'true';
    }

    // Print startup summary in debug mode
    if (debugMode) {
        console.log('\n🔍 Debug mode enabled\n');
        console.log('Startup Summary:');
        console.log(`  Agent type:     ${childEnv.AGENT_TYPE || 'claude (default)'}`);
        console.log(`  Bot script:     ${botScript}`);
        console.log(`  Worker script:  ${workerScript}`);
        console.log(`  Working dir:    ${childEnv.CLAUDE_WORKING_DIR || process.cwd()}`);
        console.log(`  Redis:          ${childEnv.REDIS_HOST || 'localhost'}:${childEnv.REDIS_PORT || '6379'}`);
        console.log(`  API bind:       ${childEnv.TETHER_API_HOST || '127.0.0.1'}:${childEnv.TETHER_API_PORT || '2643'}`);
        // Show binary override if set
        const binOverrides = ['CLAUDE_BIN', 'OPENCODE_BIN', 'CODEX_BIN'].filter(k => childEnv[k]);
        if (binOverrides.length) {
            for (const k of binOverrides) {
                console.log(`  ${k}:  ${childEnv[k]}`);
            }
        }
        console.log(`  PATH (first 3): ${(process.env.PATH || '').split(':').slice(0, 3).join(':')}`);
        console.log('');
    }

    // Start bot
    const bot = spawn(['bun', 'run', botScript], {
        stdout: 'inherit',
        stderr: 'inherit',
        env: childEnv,
    });

    // Start worker
    const worker = spawn(['bun', 'run', workerScript], {
        stdout: 'inherit',
        stderr: 'inherit',
        env: childEnv,
    });

    // Save PIDs
    writeFileSync(PID_FILE, JSON.stringify({
        bot: bot.pid,
        worker: worker.pid,
        startedAt: new Date().toISOString(),
    }));

    console.log(`Bot PID: ${bot.pid}`);
    console.log(`Worker PID: ${worker.pid}`);
    console.log('\nTether is running. Press Ctrl+C to stop.\n');

    // Graceful shutdown handler
    const shutdown = () => {
        console.log('\nStopping Tether...');
        bot.kill();
        worker.kill();
        if (existsSync(PID_FILE)) {
            const fs = require('fs');
            fs.unlinkSync(PID_FILE);
        }
        process.exit(0);
    };

    // Handle SIGINT (Ctrl+C) and SIGTERM (systemd, Docker, etc.)
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Wait for processes
    await Promise.all([bot.exited, worker.exited]);
}

function stop() {
    if (!existsSync(PID_FILE)) {
        console.log('Tether is not running.');
        return;
    }

    const pids = JSON.parse(readFileSync(PID_FILE, 'utf-8'));

    try {
        process.kill(pids.bot);
        console.log(`Stopped bot (PID ${pids.bot})`);
    } catch {
        // Process may have already exited - this is expected and safe to ignore
    }

    try {
        process.kill(pids.worker);
        console.log(`Stopped worker (PID ${pids.worker})`);
    } catch {
        // Process may have already exited - this is expected and safe to ignore
    }

    const fs = require('fs');
    fs.unlinkSync(PID_FILE);
    console.log('Tether stopped.');
}

function status() {
    if (!existsSync(PID_FILE)) {
        console.log('Tether is not running.');
        return;
    }

    const pids = JSON.parse(readFileSync(PID_FILE, 'utf-8'));

    const botAlive = isProcessRunning(pids.bot);
    const workerAlive = isProcessRunning(pids.worker);

    console.log(`Bot:    ${botAlive ? '✓ running' : '✗ stopped'} (PID ${pids.bot})`);
    console.log(`Worker: ${workerAlive ? '✓ running' : '✗ stopped'} (PID ${pids.worker})`);
    console.log(`Started: ${pids.startedAt}`);
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function health() {
    try {
        const response = await fetch(`${API_BASE}/health`);
        const data = await response.json() as { status: string; connected: boolean; user: string };

        if (data.connected) {
            console.log(`✓ Connected as ${data.user}`);
        } else {
            console.log('✗ Bot not connected to Discord');
        }
    } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
            console.log('✗ Cannot connect to Tether API. Is the bot running? (tether start)');
        } else {
            console.log(`✗ Error: ${error.message}`);
        }
        process.exit(1);
    }
}

// ============ Config ============

async function promptPassword(label = 'Password: '): Promise<string> {
    // Use raw mode to hide password input in TTY
    if (process.stdin.isTTY) {
        process.stdout.write(label);
        return new Promise((resolve) => {
            let pw = '';
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', (ch: string) => {
                if (ch === '\r' || ch === '\n') {
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdout.write('\n');
                    resolve(pw);
                } else if (ch === '\x03') {
                    process.exit(130);
                } else if (ch === '\x7f' || ch === '\b') {
                    pw = pw.slice(0, -1);
                } else {
                    pw += ch;
                }
            });
        });
    }
    
    // Non-TTY: read from stdin without echo (for pipes/CI)
    // Example: echo "my-token" | tether config set DISCORD_BOT_TOKEN
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.resume();
        
        process.stdin.on('data', (chunk: string) => {
            data += chunk;
        });
        
        process.stdin.on('end', () => {
            // Trim trailing newline from piped input
            resolve(data.trim());
        });
        
        process.stdin.on('error', (err) => {
            reject(err);
        });
    });
}

async function configCommand() {
    const subcommand = args[0];

    switch (subcommand) {
        case 'set': {
            const key = args[1];
            if (!key) {
                console.error('Usage: tether config set <key> [value]');
                process.exit(1);
            }
            if (!isKnownKey(key)) {
                console.error(`Unknown config key: ${key}`);
                console.error(`Run "tether config list" to see all keys`);
                process.exit(1);
            }

            let value = args[2];
            if (isSecret(key)) {
                if (!value) {
                    value = await promptPassword(`${key}: `);
                }
                const pw = await promptPassword('Encryption password: ');
                if (!pw) {
                    console.error('Password cannot be empty');
                    process.exit(1);
                }
                try {
                    writeSecret(key, value, pw);
                } catch (err) {
                    console.error(err instanceof Error ? err.message : 'Failed to save secret');
                    process.exit(1);
                }
                console.log(`✔ Secret "${key}" saved (encrypted)`);
            } else {
                if (value === undefined) {
                    console.error(`Usage: tether config set ${key} <value>`);
                    process.exit(1);
                }
                writePreference(key, value);
                console.log(`✔ "${key}" = "${value}"`);
            }
            break;
        }

        case 'get': {
            const key = args[1];
            if (!key) {
                console.error('Usage: tether config get <key>');
                process.exit(1);
            }
            if (!isKnownKey(key)) {
                console.error(`Unknown config key: ${key}`);
                process.exit(1);
            }

            let password: string | undefined;
            if (isSecret(key) && hasSecrets()) {
                password = await promptPassword('Encryption password: ');
            }

            const value = resolveConfig(key, password);
            const meta = getKeyMeta(key);

            // Show source
            const envValue = process.env[key];
            let source = 'default';
            if (envValue !== undefined && envValue !== '') {
                source = 'env';
            } else if (isSecret(key) && password) {
                try {
                    const secrets = readSecrets(password);
                    if (key in secrets) source = 'secrets.enc';
                } catch { /* wrong password */ }
            } else {
                const prefs = readPreferences();
                if (key in prefs) source = 'config.toml';
            }

            console.log(`${key} = ${value || '(empty)'}`);
            console.log(`  source: ${source}  section: [${meta?.section}]`);
            if (meta?.description) console.log(`  ${meta.description}`);
            break;
        }

        case 'list': {
            const keys = getKnownKeys();
            const prefs = readPreferences();

            console.log('\nTether Configuration\n');
            let currentSection = '';

            for (const key of keys) {
                const meta = getKeyMeta(key)!;
                if (meta.section !== currentSection) {
                    currentSection = meta.section;
                    console.log(`[${currentSection}]`);
                }

                // Determine value & source
                const envValue = process.env[key];
                let value: string;
                let source: string;

                if (envValue !== undefined && envValue !== '') {
                    value = isSecret(key) ? '***' : envValue;
                    source = 'env';
                } else if (isSecret(key)) {
                    value = hasSecrets() ? '(encrypted)' : '(not set)';
                    source = hasSecrets() ? 'secrets.enc' : 'default';
                } else if (key in prefs) {
                    value = prefs[key]!;
                    source = 'config.toml';
                } else {
                    value = meta.default || '(not set)';
                    source = 'default';
                }

                const pad = ' '.repeat(Math.max(1, 28 - key.length));
                console.log(`  ${key}${pad}${value}  (${source})`);
            }
            console.log('');
            break;
        }

        case 'delete':
        case 'unset': {
            const key = args[1];
            if (!key) {
                console.error('Usage: tether config delete <key>');
                process.exit(1);
            }
            if (!isKnownKey(key)) {
                console.error(`Unknown config key: ${key}`);
                process.exit(1);
            }

            let password: string | undefined;
            if (isSecret(key)) {
                password = await promptPassword('Encryption password: ');
            }

            const deleted = deleteConfigKey(key, password);
            if (deleted) {
                console.log(`✔ "${key}" deleted`);
            } else {
                console.log(`"${key}" was not set`);
            }
            break;
        }

        case 'import': {
            const envPath = args[1] || join(process.cwd(), '.env');
            if (!existsSync(envPath)) {
                console.error(`File not found: ${envPath}`);
                process.exit(1);
            }

            const pw = await promptPassword('Encryption password (for secrets): ');
            if (!pw) {
                console.error('Password cannot be empty');
                process.exit(1);
            }

            const result = importDotEnv(envPath, pw);
            console.log(`\n✔ Imported ${result.imported.length} keys:`);
            for (const k of result.imported) {
                console.log(`  ${k}${isSecret(k) ? ' (encrypted)' : ''}`);
            }
            if (result.skipped.length > 0) {
                console.log(`\n⚠ Skipped ${result.skipped.length} keys:`);
                for (const k of result.skipped) {
                    console.log(`  ${k}${isKnownKey(k) ? ' (empty/placeholder)' : ' (unknown)'}`);
                }
            }
            console.log('');
            break;
        }

        case 'path': {
            console.log(`Config dir:    ${CONFIG_PATHS.CONFIG_DIR}`);
            console.log(`Preferences:   ${CONFIG_PATHS.CONFIG_PATH}  ${hasConfig() ? '✔' : '(not created)'}`);
            console.log(`Secrets:       ${CONFIG_PATHS.SECRETS_PATH}  ${hasSecrets() ? '✔' : '(not created)'}`);
            break;
        }

        default:
            console.log(`
Usage: tether config <subcommand>

Subcommands:
  set <key> [value]    Set a config value (prompts for secrets)
  get <key>            Get a resolved config value
  list                 List all config values with sources
  delete <key>         Delete a config value
  import [path]        Import from .env file (default: ./.env)
  path                 Show config file locations
`);
            if (subcommand) {
                console.error(`Unknown config subcommand: ${subcommand}`);
                process.exit(1);
            }
            break;
    }
}

function showHelp() {
    console.log(`
Tether - Distether to Claude Code bridge

Usage: tether <command> [options]

Management Commands:
  start              Start bot and worker
      --debug        Enable debug logging (alias: --verbose)
      --verbose      Enable debug logging (alias: --debug)
  stop               Stop all processes
  status             Show running status
  health             Check Distether connection
  setup              Interactive setup wizard
  config             Manage configuration and encrypted secrets
  project            Manage named projects
  help               Show this help

Distether Commands:
  send <channel> "message"
      Send a text message

  embed <channel> "description" [options]
      Send an embed with optional formatting
      --title "..."          Embed title
      --url "..."            Title link URL
      --color <name|hex>     red, green, blue, yellow, purple, orange, or 0xHEX
      --author "..."         Author name
      --author-url "..."     Author link
      --author-icon "..."    Author icon URL
      --thumbnail "..."      Small image (top right)
      --image "..."          Large image (bottom)
      --footer "..."         Footer text
      --footer-icon "..."    Footer icon URL
      --timestamp            Add current timestamp
      --field "Name:Value"   Add field (use :inline for inline)

  file <channel> <filepath> ["message"]
      Send a file attachment

  buttons <channel> "prompt" --button label="..." id="..." [options]
      Send interactive buttons
      Button options:
        label="..."          Button text (required)
        id="..."             Custom ID (required)
        style="..."          primary, secondary, success, danger
        reply="..."          Ephemeral reply when clicked
        webhook="..."        URL to POST click data to

  ask <channel> "question" --option "A" --option "B" [--timeout 300]
      Ask a blocking question with button options (blocks until answered)
      Prints selected answer to stdout, exits 0 on success, 1 on timeout
      Automatically includes a "Type answer" button for free-form input

  typing <channel>
      Show typing indicator

  edit <channel> <messageId> "content"
      Edit an existing message

  delete <channel> <messageId>
      Delete a message

  rename <threadId> "name"
      Rename a thread

  reply <channel> <messageId> "message"
      Reply to a specific message

  thread <channel> <messageId> "name"
      Create a thread from a message

  react <channel> <messageId> "emoji"
      Add a reaction to a message

   state <channel> <messageId> <state>
      Update thread status with preset or custom text
      Presets: processing, thinking, searching, writing, done, error, waiting

DM Commands (proactive outreach):
  dm <user-id> "message"
      Send a text DM to a user

  dm <user-id> --embed "description" [options]
      Send an embed DM (same options as embed command)

   dm <user-id> --file <filepath> ["message"]
       Send a file attachment via DM

Config Commands:
   config set <key> [value]     Set a config value (prompts for secrets)
   config get <key>             Get a resolved config value with source
   config list                  List all config values with sources
   config delete <key>          Delete a config value
   config import [path]         Import from .env file (default: ./.env)
   config path                  Show config file locations

Project Commands:
   project add <name> <path>    Register a named project directory
   project list                 List all registered projects
   project remove <name>        Remove a project
   project set-default <name>   Set a project as the default

Examples:
   tether send 123456789 "Hello world!"
   tether embed 123456789 "Status update" --title "Daily Report" --color green --field "Tasks:5 done:inline"
   tether buttons 123456789 "Approve?" --button label="Yes" id="approve" style="success" reply="Approved!"
   tether ask 123456789 "Deploy to prod?" --option "Yes" --option "No" --timeout 600
   tether file 123456789 ./report.md "Here's the report"
   tether state 123456789 1234567890 processing
   tether state 123456789 1234567890 done
   tether dm 987654321 "Hey, I need your approval on this PR"
   tether dm 987654321 --embed "Build passed" --title "CI Update" --color green
   tether dm 987654321 --file ./report.md "Here's the report"
   tether config set AGENT_TYPE opencode
   tether config set DISCORD_BOT_TOKEN
   tether config import .env
   tether config list
`);
}

// ============ Main ============

switch (command) {
    // Management
    case 'start':
        start();
        break;
    case 'stop':
        stop();
        break;
    case 'status':
        status();
        break;
    case 'setup':
        setup();
        break;
    case 'health':
        health();
        break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
        showHelp();
        break;

    // Distether commands
    case 'send':
        sendMessage();
        break;
    case 'embed':
        sendEmbed();
        break;
    case 'file':
        sendFile();
        break;
    case 'buttons':
        sendButtons();
        break;
    case 'ask':
        askQuestion();
        break;
    case 'typing':
        startTyping();
        break;
    case 'edit':
        editMessage();
        break;
    case 'delete':
        deleteMessage();
        break;
    case 'rename':
        renameThread();
        break;
    case 'reply':
        replyToMessage();
        break;
    case 'thread':
        createThread();
        break;
    case 'react':
        addReaction();
        break;
    case 'state':
        updateState();
        break;
    case 'dm':
        sendDM();
        break;
    case 'config':
        configCommand();
        break;
    case 'project':
        projectCommand();
        break;

    default:
        console.log(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
