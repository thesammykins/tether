/**
 * Project management feature - shared handlers for slash and text commands.
 *
 * Both /cord project ... and !project ... dispatch into these functions
 * so the business logic lives in one place.
 */

import { existsSync, realpathSync } from 'fs';
import { resolve } from 'path';
import {
    createProject,
    getProject,
    listProjects,
    setProjectDefault,
    setChannelProject,
    getChannelProject,
    db,
} from '../db.js';
import type { Project } from '../db.js';

const log = (msg: string) => process.stdout.write(`[projects] ${msg}\n`);

// Allowed working directories (read once, shared with bot.ts logic)
const ALLOWED_DIRS = process.env.CORD_ALLOWED_DIRS
    ? process.env.CORD_ALLOWED_DIRS.split(',').map(d => resolve(d.trim()))
    : null;

/**
 * Validate a directory path exists and is within CORD_ALLOWED_DIRS.
 * Returns null when valid, or an error string.
 */
function validatePath(dir: string): string | null {
    const resolved = resolve(dir);

    if (!existsSync(resolved)) {
        return `Directory not found: \`${dir}\``;
    }

    let realPath: string;
    try {
        realPath = realpathSync(resolved);
    } catch (error) {
        return `Cannot resolve path: \`${dir}\` (${error instanceof Error ? error.message : String(error)})`;
    }

    if (!ALLOWED_DIRS) {
        return null;
    }

    const isAllowed = ALLOWED_DIRS.some(allowed => {
        let allowedReal: string;
        try {
            allowedReal = realpathSync(allowed);
        } catch {
            return false;
        }
        return realPath === allowedReal || realPath.startsWith(allowedReal + '/');
    });

    if (!isAllowed) {
        return `Directory not in allowed list. Allowed: ${ALLOWED_DIRS.join(', ')}`;
    }

    return null;
}

export interface CommandResult {
    success: boolean;
    message: string;
}

/**
 * Register a new project.
 */
export function handleProjectAdd(name: string, path: string): CommandResult {
    const validationError = validatePath(path);
    if (validationError) {
        return { success: false, message: validationError };
    }

    const resolvedPath = resolve(path);

    try {
        createProject(name, resolvedPath);
        log(`Project '${name}' registered at ${resolvedPath}`);
        return { success: true, message: `Project **${name}** registered at \`${resolvedPath}\`` };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Failed to create project '${name}': ${msg}`);
        return { success: false, message: `Failed to register project: ${msg}` };
    }
}

/**
 * List all registered projects, returning both raw data and a formatted string.
 */
export function handleProjectList(): { projects: Project[]; formatted: string } {
    const projects = listProjects();

    if (projects.length === 0) {
        return { projects, formatted: 'No projects registered. Use `/cord project add` or `!project add <name> <path>` to add one.' };
    }

    const lines = projects.map(p => {
        const def = p.is_default ? ' **(default)**' : '';
        return `- **${p.name}**${def} — \`${p.path}\``;
    });

    return { projects, formatted: `**Registered Projects**\n${lines.join('\n')}` };
}

/**
 * Set a project as the global default.
 */
export function handleProjectDefault(name: string): CommandResult {
    const project = getProject(name);
    if (!project) {
        return { success: false, message: `Project **${name}** not found.` };
    }

    try {
        setProjectDefault(name);
        log(`Project '${name}' set as default`);
        return { success: true, message: `Project **${name}** set as default.` };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Failed to set default: ${msg}` };
    }
}

/**
 * Bind a project to a specific channel.
 */
export function handleProjectUse(channelId: string, name: string): CommandResult {
    const project = getProject(name);
    if (!project) {
        return { success: false, message: `Project **${name}** not found.` };
    }

    try {
        setChannelProject(channelId, name);
        log(`Channel ${channelId} bound to project '${name}'`);
        return {
            success: true,
            message: `Channel now uses project **${name}** (\`${project.path}\`).`,
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, message: `Failed to set channel project: ${msg}` };
    }
}

/**
 * Validate that a session ID exists in the threads table.
 * Returns the thread row if found, or null.
 */
export function findSession(sessionId: string): { thread_id: string; session_id: string; working_dir: string | null; project_name: string | null } | null {
    // Try exact match first
    const exact = db.query('SELECT thread_id, session_id, working_dir, project_name FROM threads WHERE session_id = ?')
        .get(sessionId) as { thread_id: string; session_id: string; working_dir: string | null; project_name: string | null } | null;
    if (exact) return exact;

    // Try prefix match (user may supply truncated ID)
    // Escape SQL LIKE wildcards in user input to prevent unintended matches
    const escaped = sessionId.replace(/[%_]/g, '\\$&');
    const prefix = db.query("SELECT thread_id, session_id, working_dir, project_name FROM threads WHERE session_id LIKE ? ESCAPE '\\'")
        .get(`${escaped}%`) as { thread_id: string; session_id: string; working_dir: string | null; project_name: string | null } | null;
    return prefix;
}

/**
 * Handle session attach - validate the session exists and return info.
 * Thread creation happens in bot.ts since it needs Discord API.
 */
export function handleSessionAttach(sessionId: string): CommandResult & { session?: { thread_id: string; session_id: string; working_dir: string | null; project_name: string | null } } {
    const session = findSession(sessionId);
    if (!session) {
        return { success: false, message: `Session \`${sessionId}\` not found.` };
    }

    log(`Attach requested for session ${session.session_id}`);
    return {
        success: true,
        message: `Attaching to session \`${session.session_id.slice(0, 8)}...\``,
        session,
    };
}

/**
 * List recent sessions for autocomplete. Returns session IDs with age info.
 */
export function getRecentSessions(filter: string, limit = 25): Array<{ name: string; value: string }> {
    const rows = db.query(`
        SELECT session_id, created_at FROM threads
        ORDER BY created_at DESC
        LIMIT 50
    `).all() as Array<{ session_id: string; created_at: string }>;

    const now = Date.now();
    return rows
        .filter(r => r.session_id.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, limit)
        .map(r => {
            const age = formatRelativeTime(r.created_at, now);
            const short = r.session_id.slice(0, 8);
            return { name: `${short}... (${age})`, value: r.session_id };
        });
}

function formatRelativeTime(dateStr: string, now: number): string {
    const ms = now - new Date(dateStr).getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
