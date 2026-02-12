/**
 * Config Store — Encrypted secrets + TOML preferences
 *
 * Architecture:
 *   ~/.config/tether/config.toml   — plaintext preferences (agent type, ports, etc.)
 *   ~/.config/tether/secrets.enc   — AES-256-GCM encrypted secrets (tokens)
 *
 * Resolution order: process.env > .env > config.toml/secrets.enc > defaults
 *
 * Encryption: PBKDF2 (100k iterations, SHA-512) → AES-256-GCM
 * Binary format: salt(64B) || iv(12B) || authTag(16B) || ciphertext
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// Config directory — resolved lazily for testability
let _configDir: string | null = null;

function getConfigDir(): string {
    if (!_configDir) {
        _configDir = process.env.TETHER_CONFIG_DIR || join(homedir(), '.config', 'tether');
    }
    return _configDir;
}

function getConfigPath(): string { return join(getConfigDir(), 'config.toml'); }
function getSecretsPath(): string { return join(getConfigDir(), 'secrets.enc'); }

/** Override config directory (for testing). Call before any config operations. */
export function setConfigDir(dir: string): void { _configDir = dir; }

// Crypto constants
const SALT_LENGTH = 64;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';

// Which keys are secrets (encrypted) vs preferences (plaintext TOML)
const SECRET_KEYS = new Set(['DISCORD_BOT_TOKEN', 'API_TOKEN']);

// All known config keys with their defaults and TOML sections
interface ConfigKeyMeta {
    section: string;
    default: string;
    description: string;
}

const CONFIG_KEYS: Record<string, ConfigKeyMeta> = {
    // Secrets (stored encrypted)
    DISCORD_BOT_TOKEN: { section: 'secrets', default: '', description: 'Discord bot token' },
    API_TOKEN: { section: 'secrets', default: '', description: 'API authentication token' },

    // Agent
    AGENT_TYPE: { section: 'agent', default: 'claude', description: 'Agent type (claude, opencode, codex)' },
    CLAUDE_WORKING_DIR: { section: 'agent', default: '', description: 'Default working directory for agent sessions' },
    CLAUDE_BIN: { section: 'agent', default: '', description: 'Override path to Claude CLI binary' },
    OPENCODE_BIN: { section: 'agent', default: '', description: 'Override path to OpenCode CLI binary' },
    CODEX_BIN: { section: 'agent', default: '', description: 'Override path to Codex CLI binary' },

    // Server
    TETHER_API_HOST: { section: 'server', default: '127.0.0.1', description: 'API server bind address' },
    TETHER_API_PORT: { section: 'server', default: '2643', description: 'API server port' },

    // Redis
    REDIS_HOST: { section: 'redis', default: 'localhost', description: 'Redis host' },
    REDIS_PORT: { section: 'redis', default: '6379', description: 'Redis port' },

    // Security
    ALLOWED_USERS: { section: 'security', default: '', description: 'Comma-separated Discord user IDs' },
    ALLOWED_ROLES: { section: 'security', default: '', description: 'Comma-separated Discord role IDs' },
    ALLOWED_CHANNELS: { section: 'security', default: '', description: 'Comma-separated Discord channel IDs' },
    CORD_ALLOWED_DIRS: { section: 'security', default: '', description: 'Comma-separated allowed working directories' },

    // Limits
    RATE_LIMIT_REQUESTS: { section: 'limits', default: '5', description: 'Rate limit: max requests per window' },
    RATE_LIMIT_WINDOW_MS: { section: 'limits', default: '60000', description: 'Rate limit: window in milliseconds' },
    MAX_TURNS_PER_SESSION: { section: 'limits', default: '50', description: 'Max turns per session' },
    MAX_SESSION_DURATION_MS: { section: 'limits', default: '3600000', description: 'Max session duration in milliseconds' },

    // Features
    ENABLE_DMS: { section: 'features', default: 'false', description: 'Enable direct message support' },
    FORUM_SESSIONS: { section: 'features', default: 'false', description: 'Use forum channel posts instead of text channel threads' },
    FORUM_CHANNEL_ID: { section: 'features', default: '', description: 'Discord forum channel ID for session posts' },

    // Database
    DB_PATH: { section: 'database', default: './data/threads.db', description: 'SQLite database path' },

    // Misc
    TZ: { section: 'misc', default: 'UTC', description: 'Timezone for datetime injection' },
};

// --- Crypto helpers ---

function deriveKey(password: string, salt: Buffer): Buffer {
    return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

function encrypt(plaintext: string, password: string): Buffer {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(password, salt);

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // salt(64) || iv(12) || authTag(16) || ciphertext
    return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decrypt(blob: Buffer, password: string): string {
    if (blob.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
        throw new Error('Encrypted data is too short');
    }

    const salt = blob.subarray(0, SALT_LENGTH);
    const iv = blob.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = blob.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = blob.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

// --- TOML helpers ---

/** Parse flat-section TOML into Record<section, Record<key, value>> */
function parseTOML(content: string): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    let currentSection = '';

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const sectionMatch = line.match(/^\[([^\]]+)\]$/);
        if (sectionMatch?.[1]) {
            currentSection = sectionMatch[1];
            result[currentSection] = result[currentSection] || {};
            continue;
        }

        const kvMatch = line.match(/^(\w+)\s*=\s*"(.*)"\s*$/);
        if (kvMatch?.[1] && currentSection) {
            const section = result[currentSection] ??= {};
            section[kvMatch[1]] = kvMatch[2] ?? '';
        }
    }

    return result;
}

/** Serialize flat-section data to TOML string */
function serializeTOML(data: Record<string, Record<string, string>>): string {
    const lines: string[] = [];

    for (const [section, entries] of Object.entries(data)) {
        if (Object.keys(entries).length === 0) continue;
        lines.push(`[${section}]`);
        for (const [key, value] of Object.entries(entries)) {
            lines.push(`${key} = "${value}"`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// --- Config Store ---

export function ensureConfigDir(): void {
    mkdirSync(getConfigDir(), { recursive: true });
}

/** Read all preferences from config.toml */
export function readPreferences(): Record<string, string> {
    if (!existsSync(getConfigPath())) return {};

    const content = readFileSync(getConfigPath(), 'utf-8');
    const sections = parseTOML(content);
    const flat: Record<string, string> = {};

    for (const entries of Object.values(sections)) {
        for (const [key, value] of Object.entries(entries)) {
            flat[key] = value;
        }
    }

    return flat;
}

/** Write a single preference to config.toml (merges with existing) */
export function writePreference(key: string, value: string): void {
    ensureConfigDir();
    const meta = CONFIG_KEYS[key];
    if (!meta) throw new Error(`Unknown config key: ${key}`);

    const sections = existsSync(getConfigPath())
        ? parseTOML(readFileSync(getConfigPath(), 'utf-8'))
        : {};

    sections[meta.section] = sections[meta.section] || {};
    const sectionObj = sections[meta.section]!;
    sectionObj[key] = value;

    writeFileSync(getConfigPath(), serializeTOML(sections));
}

/** Read all secrets (requires password) */
export function readSecrets(password: string): Record<string, string> {
    if (!existsSync(getSecretsPath())) return {};

    const blob = readFileSync(getSecretsPath());
    const json = decrypt(blob, password);
    return JSON.parse(json);
}

/** Write a single secret (requires password, merges with existing) */
export function writeSecret(key: string, value: string, password: string): void {
    ensureConfigDir();

    let secrets: Record<string, string> = {};
    if (existsSync(getSecretsPath())) {
        try {
            secrets = readSecrets(password);
        } catch {
            throw new Error('Wrong password. Use the same password you set previously, or delete ~/.config/tether/secrets.enc to start fresh.');
        }
    }

    secrets[key] = value;
    const blob = encrypt(JSON.stringify(secrets), password);
    writeFileSync(getSecretsPath(), blob);
}

/** Delete a key from config (preferences or secrets) */
export function deleteKey(key: string, password?: string): boolean {
    if (SECRET_KEYS.has(key)) {
        if (!password) throw new Error('Password required to modify secrets');
        if (!existsSync(getSecretsPath())) return false;

        let secrets: Record<string, string>;
        try {
            secrets = readSecrets(password);
        } catch {
            throw new Error('Wrong password. Use the same password you set previously.');
        }
        if (!(key in secrets)) return false;
        delete secrets[key];

        const blob = encrypt(JSON.stringify(secrets), password);
        writeFileSync(getSecretsPath(), blob);
        return true;
    }

    if (!existsSync(getConfigPath())) return false;

    const sections = parseTOML(readFileSync(getConfigPath(), 'utf-8'));
    const meta = CONFIG_KEYS[key];
    if (!meta) return false;

    if (!sections[meta.section] || !(key in sections[meta.section]!)) return false;
    delete sections[meta.section]![key];

    writeFileSync(getConfigPath(), serializeTOML(sections));
    return true;
}

/**
 * Resolve a config value using the priority chain:
 *   process.env > config store > default
 *
 * Note: .env is already loaded by Bun into process.env, so we don't
 * need to handle it separately.
 */
export function resolve(key: string, password?: string): string {
    // 1. Environment variable (includes .env via Bun auto-load)
    const envValue = process.env[key];
    if (envValue !== undefined && envValue !== '') return envValue;

    // 2. Config store (preferences or secrets)
    if (SECRET_KEYS.has(key)) {
        if (password) {
            try {
                const secrets = readSecrets(password);
                if (key in secrets && secrets[key]) return secrets[key];
            } catch {
                // Wrong password or corrupted — fall through to default
            }
        }
    } else {
        const prefs = readPreferences();
        if (key in prefs && prefs[key]) return prefs[key];
    }

    // 3. Default
    return CONFIG_KEYS[key]?.default ?? '';
}

/** Resolve all config values (non-secret keys only unless password provided) */
export function resolveAll(password?: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const key of Object.keys(CONFIG_KEYS)) {
        if (SECRET_KEYS.has(key) && !password) {
            result[key] = process.env[key] ? '***' : '';
            continue;
        }
        result[key] = resolve(key, password);
    }

    return result;
}

/** Check if a key is a known config key */
export function isKnownKey(key: string): boolean {
    return key in CONFIG_KEYS;
}

/** Check if a key is a secret */
export function isSecret(key: string): boolean {
    return SECRET_KEYS.has(key);
}

/** Get metadata for a key */
export function getKeyMeta(key: string): ConfigKeyMeta | undefined {
    return CONFIG_KEYS[key];
}

/** Get all known keys */
export function getKnownKeys(): string[] {
    return Object.keys(CONFIG_KEYS);
}

/** Check if secrets file exists */
export function hasSecrets(): boolean {
    return existsSync(getSecretsPath());
}

/** Check if config file exists */
export function hasConfig(): boolean {
    return existsSync(getConfigPath());
}

/**
 * Import values from a .env file into config store.
 * Returns { imported: string[], skipped: string[] }
 */
export function importDotEnv(envPath: string, password: string): { imported: string[]; skipped: string[] } {
    if (!existsSync(envPath)) throw new Error(`File not found: ${envPath}`);

    const content = readFileSync(envPath, 'utf-8');
    const imported: string[] = [];
    const skipped: string[] = [];

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const match = line.match(/^(\w+)=(.*)$/);
        if (!match) continue;

        const key = match[1]!;
        const rawValue = match[2] ?? '';
        // Strip surrounding quotes if present
        const value = rawValue.replace(/^["']|["']$/g, '').trim();

        if (!isKnownKey(key)) {
            skipped.push(key);
            continue;
        }

        // Skip empty/placeholder values
        if (!value || value === 'your-bot-token-here') {
            skipped.push(key);
            continue;
        }

        if (isSecret(key)) {
            writeSecret(key, value, password);
        } else {
            writePreference(key, value);
        }

        imported.push(key);
    }

    return { imported, skipped };
}

// Export paths for testing/CLI display
export const CONFIG_PATHS = {
    get CONFIG_DIR() { return getConfigDir(); },
    get CONFIG_PATH() { return getConfigPath(); },
    get SECRETS_PATH() { return getSecretsPath(); },
} as const;
