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
} catch {}

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

// Create index for faster lookups
db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_session
    ON threads(session_id)
`);

console.log(`[db] SQLite database ready at ${DB_PATH}`);
