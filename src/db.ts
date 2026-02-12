/**
 * Database - SQLite for thread → session mappings
 *
 * Simple key-value store:
 * - thread_id (Discord thread ID)
 * - session_id (Claude session UUID)
 *
 * When a follow-up message comes in a thread, we look up
 * the session ID to use --resume.
 */

import { Database } from 'bun:sqlite';

const DB_PATH = process.env.DB_PATH || './data/threads.db';

// Ensure data directory exists
import { mkdirSync } from 'fs';
import { dirname } from 'path';
try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
} catch { /* Directory already exists or permission issue */ }

// Open database
export const db = new Database(DB_PATH);

// Create tables if they don't exist
db.run(`
    CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Create channels config table
db.run(`
    CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        working_dir TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Add working_dir column to threads table (migration)
try {
    db.run(`ALTER TABLE threads ADD COLUMN working_dir TEXT`);
} catch {} // Column may already exist

// Create index for faster lookups
db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_session
    ON threads(session_id)
`);

// Create paused_threads table
db.run(`
    CREATE TABLE IF NOT EXISTS paused_threads (
        thread_id TEXT PRIMARY KEY,
        paused_at INTEGER NOT NULL,
        paused_by TEXT
    )
`);

// Create held_messages table
db.run(`
    CREATE TABLE IF NOT EXISTS held_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
`);

// Create projects table
db.run(`
    CREATE TABLE IF NOT EXISTS projects (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Add project_name column to channels table (migration)
try {
    db.run(`ALTER TABLE channels ADD COLUMN project_name TEXT REFERENCES projects(name)`);
} catch { /* Column may already exist */ }

// Add project_name column to threads table (migration)
try {
    db.run(`ALTER TABLE threads ADD COLUMN project_name TEXT REFERENCES projects(name)`);
} catch { /* Column may already exist */ }

// Note: rate limiting is handled in-memory, see src/middleware/rate-limiter.ts

console.log(`[db] SQLite database ready at ${DB_PATH}`);

// In-memory cache for channel configs (TTL: 60 seconds)
// Note: setChannelConfig() invalidates cache on write (defense-in-depth)
const CACHE_TTL_MS = 60 * 1000;
const channelConfigCache = new Map<string, { data: { working_dir: string | null } | null; expiresAt: number }>();

// Helper functions for channel config
function getChannelConfig(channelId: string): { working_dir: string | null } | null {
    return db.query('SELECT working_dir FROM channels WHERE channel_id = ?')
        .get(channelId) as { working_dir: string | null } | null;
}

export function getChannelConfigCached(channelId: string): { working_dir: string | null } | null {
    const cached = channelConfigCache.get(channelId);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    // Cache miss or expired - fetch from DB
    const data = getChannelConfig(channelId);
    channelConfigCache.set(channelId, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
}

export function setChannelConfig(channelId: string, workingDir: string): void {
    db.run(`
        INSERT INTO channels (channel_id, working_dir) VALUES (?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET working_dir = ?, updated_at = CURRENT_TIMESTAMP
    `, [channelId, workingDir, workingDir]);

    // Invalidate cache
    channelConfigCache.delete(channelId);
}

export function updateSessionId(threadId: string, sessionId: string): void {
    db.run(`
        UPDATE threads SET session_id = ? WHERE thread_id = ?
    `, [sessionId, threadId]);
}

// --- Project types and helpers ---

export interface Project {
    name: string;
    path: string;
    is_default: number;
    created_at: string;
}

export function createProject(name: string, path: string, isDefault?: boolean): void {
    db.transaction(() => {
        if (isDefault) {
            db.run(`UPDATE projects SET is_default = 0 WHERE is_default = 1`);
        }
        db.run(`
            INSERT INTO projects (name, path, is_default) VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET path = ?, is_default = ?
        `, [name, path, isDefault ? 1 : 0, path, isDefault ? 1 : 0]);
    })();
}

export function getProject(name: string): Project | null {
    return db.query('SELECT * FROM projects WHERE name = ?')
        .get(name) as Project | null;
}

export function getDefaultProject(): Project | null {
    return db.query('SELECT * FROM projects WHERE is_default = 1')
        .get() as Project | null;
}

export function listProjects(): Project[] {
    return db.query('SELECT * FROM projects ORDER BY name')
        .all() as Project[];
}

export function deleteProject(name: string): void {
    db.transaction(() => {
        db.run(`UPDATE channels SET project_name = NULL WHERE project_name = ?`, [name]);
        db.run(`UPDATE threads SET project_name = NULL WHERE project_name = ?`, [name]);
        db.run(`DELETE FROM projects WHERE name = ?`, [name]);
    })();
}

export function setProjectDefault(name: string): void {
    db.transaction(() => {
        db.run(`UPDATE projects SET is_default = 0 WHERE is_default = 1`);
        db.run(`UPDATE projects SET is_default = 1 WHERE name = ?`, [name]);
    })();
}

export function getChannelProject(channelId: string): Project | null {
    const row = db.query(`
        SELECT p.* FROM projects p
        JOIN channels c ON c.project_name = p.name
        WHERE c.channel_id = ?
    `).get(channelId) as Project | null;
    return row;
}

export function setChannelProject(channelId: string, projectName: string): void {
    // Look up project path to keep working_dir in sync for legacy code paths
    const project = db.query('SELECT path FROM projects WHERE name = ?')
        .get(projectName) as { path: string } | null;
    const workingDir = project?.path ?? null;
    db.run(`
        INSERT INTO channels (channel_id, project_name, working_dir) VALUES (?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET project_name = ?, working_dir = COALESCE(?, working_dir), updated_at = CURRENT_TIMESTAMP
    `, [channelId, projectName, workingDir, projectName, workingDir]);
}

export function getThreadProject(threadId: string): Project | null {
    const row = db.query(`
        SELECT p.* FROM projects p
        JOIN threads t ON t.project_name = p.name
        WHERE t.thread_id = ?
    `).get(threadId) as Project | null;
    return row;
}

export function setThreadProject(threadId: string, projectName: string): void {
    db.run(`
        UPDATE threads SET project_name = ? WHERE thread_id = ?
    `, [projectName, threadId]);
}
