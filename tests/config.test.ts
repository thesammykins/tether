/**
 * Tests for config store — TOML preferences, encrypted secrets, resolution chain
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
    setConfigDir, ensureConfigDir,
    readPreferences, writePreference,
    readSecrets, writeSecret,
    deleteKey, resolve, resolveAll,
    isKnownKey, isSecret, getKeyMeta, getKnownKeys,
    hasSecrets, hasConfig,
    importDotEnv, CONFIG_PATHS,
} from '../src/config';

const TEST_DIR = join(process.cwd(), '.tmp-test-config');
const PASSWORD = 'test-password-123';

function cleanTestDir() {
    if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
}

beforeEach(() => {
    cleanTestDir();
    setConfigDir(TEST_DIR);
});

afterAll(() => {
    cleanTestDir();
});

// --- Key metadata ---

describe('Key metadata', () => {
    it('recognizes known keys', () => {
        expect(isKnownKey('AGENT_TYPE')).toBe(true);
        expect(isKnownKey('DISCORD_BOT_TOKEN')).toBe(true);
        expect(isKnownKey('TOTALLY_FAKE_KEY')).toBe(false);
    });

    it('identifies secrets', () => {
        expect(isSecret('DISCORD_BOT_TOKEN')).toBe(true);
        expect(isSecret('API_TOKEN')).toBe(true);
        expect(isSecret('AGENT_TYPE')).toBe(false);
    });

    it('returns key metadata', () => {
        const meta = getKeyMeta('AGENT_TYPE');
        expect(meta).toBeDefined();
        expect(meta!.section).toBe('agent');
        expect(meta!.default).toBe('claude');
    });

    it('returns undefined for unknown key meta', () => {
        expect(getKeyMeta('NOPE')).toBeUndefined();
    });

    it('lists all known keys', () => {
        const keys = getKnownKeys();
        expect(keys.length).toBeGreaterThan(10);
        expect(keys).toContain('AGENT_TYPE');
        expect(keys).toContain('DISCORD_BOT_TOKEN');
    });
});

// --- Config directory ---

describe('Config directory', () => {
    it('creates config dir on ensureConfigDir', () => {
        expect(existsSync(TEST_DIR)).toBe(false);
        ensureConfigDir();
        expect(existsSync(TEST_DIR)).toBe(true);
    });

    it('CONFIG_PATHS reflects test dir', () => {
        expect(CONFIG_PATHS.CONFIG_DIR).toBe(TEST_DIR);
        expect(CONFIG_PATHS.CONFIG_PATH).toBe(join(TEST_DIR, 'config.toml'));
        expect(CONFIG_PATHS.SECRETS_PATH).toBe(join(TEST_DIR, 'secrets.enc'));
    });

    it('hasConfig/hasSecrets return false before creation', () => {
        expect(hasConfig()).toBe(false);
        expect(hasSecrets()).toBe(false);
    });
});

// --- Preferences (TOML) ---

describe('Preferences', () => {
    it('reads empty when no config file', () => {
        expect(readPreferences()).toEqual({});
    });

    it('writes and reads a preference', () => {
        writePreference('AGENT_TYPE', 'opencode');
        expect(hasConfig()).toBe(true);

        const prefs = readPreferences();
        expect(prefs['AGENT_TYPE']).toBe('opencode');
    });

    it('merges preferences across writes', () => {
        writePreference('AGENT_TYPE', 'opencode');
        writePreference('REDIS_PORT', '6380');

        const prefs = readPreferences();
        expect(prefs['AGENT_TYPE']).toBe('opencode');
        expect(prefs['REDIS_PORT']).toBe('6380');
    });

    it('overwrites existing preference', () => {
        writePreference('AGENT_TYPE', 'opencode');
        writePreference('AGENT_TYPE', 'codex');

        const prefs = readPreferences();
        expect(prefs['AGENT_TYPE']).toBe('codex');
    });

    it('throws on unknown key', () => {
        expect(() => writePreference('BOGUS_KEY', 'value')).toThrow('Unknown config key');
    });

    it('handles values with special characters', () => {
        writePreference('CLAUDE_WORKING_DIR', '/home/user/my project');
        const prefs = readPreferences();
        expect(prefs['CLAUDE_WORKING_DIR']).toBe('/home/user/my project');
    });
});

// --- Secrets (encrypted) ---

describe('Secrets', () => {
    it('reads empty when no secrets file', () => {
        expect(readSecrets(PASSWORD)).toEqual({});
    });

    it('encrypts and decrypts a secret', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'my-token-123', PASSWORD);
        expect(hasSecrets()).toBe(true);

        const secrets = readSecrets(PASSWORD);
        expect(secrets['DISCORD_BOT_TOKEN']).toBe('my-token-123');
    });

    it('merges secrets across writes', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'token-1', PASSWORD);
        writeSecret('API_TOKEN', 'token-2', PASSWORD);

        const secrets = readSecrets(PASSWORD);
        expect(secrets['DISCORD_BOT_TOKEN']).toBe('token-1');
        expect(secrets['API_TOKEN']).toBe('token-2');
    });

    it('overwrites existing secret', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'old', PASSWORD);
        writeSecret('DISCORD_BOT_TOKEN', 'new', PASSWORD);

        const secrets = readSecrets(PASSWORD);
        expect(secrets['DISCORD_BOT_TOKEN']).toBe('new');
    });

    it('fails with wrong password', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'secret', PASSWORD);
        expect(() => readSecrets('wrong-password')).toThrow();
    });

    it('each encryption produces different ciphertext (random salt/IV)', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'same-value', PASSWORD);
        const { readFileSync } = require('fs');
        const blob1 = readFileSync(CONFIG_PATHS.SECRETS_PATH);

        writeSecret('DISCORD_BOT_TOKEN', 'same-value', PASSWORD);
        const blob2 = readFileSync(CONFIG_PATHS.SECRETS_PATH);

        // Different salt/IV means different blob even for same plaintext
        expect(Buffer.compare(blob1, blob2)).not.toBe(0);
    });
});

// --- Delete key ---

describe('deleteKey', () => {
    it('deletes a preference', () => {
        writePreference('AGENT_TYPE', 'opencode');
        expect(deleteKey('AGENT_TYPE')).toBe(true);

        const prefs = readPreferences();
        expect(prefs['AGENT_TYPE']).toBeUndefined();
    });

    it('returns false if preference not set', () => {
        expect(deleteKey('AGENT_TYPE')).toBe(false);
    });

    it('deletes a secret', () => {
        writeSecret('DISCORD_BOT_TOKEN', 'token', PASSWORD);
        expect(deleteKey('DISCORD_BOT_TOKEN', PASSWORD)).toBe(true);

        const secrets = readSecrets(PASSWORD);
        expect(secrets['DISCORD_BOT_TOKEN']).toBeUndefined();
    });

    it('throws when deleting secret without password', () => {
        expect(() => deleteKey('DISCORD_BOT_TOKEN')).toThrow('Password required');
    });

    it('returns false for unknown key', () => {
        writePreference('AGENT_TYPE', 'claude');
        expect(deleteKey('NOT_A_KEY')).toBe(false);
    });
});

// --- Resolution ---

describe('resolve', () => {
    it('returns default when nothing is set', () => {
        // Clear env to avoid interference
        const saved = process.env.AGENT_TYPE;
        delete process.env.AGENT_TYPE;

        expect(resolve('AGENT_TYPE')).toBe('claude');

        if (saved !== undefined) process.env.AGENT_TYPE = saved;
    });

    it('config file overrides default', () => {
        const saved = process.env.AGENT_TYPE;
        delete process.env.AGENT_TYPE;

        writePreference('AGENT_TYPE', 'opencode');
        expect(resolve('AGENT_TYPE')).toBe('opencode');

        if (saved !== undefined) process.env.AGENT_TYPE = saved;
    });

    it('env var overrides config file', () => {
        writePreference('AGENT_TYPE', 'opencode');
        process.env.AGENT_TYPE = 'from-env';

        expect(resolve('AGENT_TYPE')).toBe('from-env');

        delete process.env.AGENT_TYPE;
    });

    it('resolves secret with password', () => {
        const saved = process.env.DISCORD_BOT_TOKEN;
        delete process.env.DISCORD_BOT_TOKEN;

        writeSecret('DISCORD_BOT_TOKEN', 'my-token', PASSWORD);
        expect(resolve('DISCORD_BOT_TOKEN', PASSWORD)).toBe('my-token');

        if (saved !== undefined) process.env.DISCORD_BOT_TOKEN = saved;
    });

    it('falls back to default on wrong password', () => {
        const saved = process.env.DISCORD_BOT_TOKEN;
        delete process.env.DISCORD_BOT_TOKEN;

        writeSecret('DISCORD_BOT_TOKEN', 'my-token', PASSWORD);
        expect(resolve('DISCORD_BOT_TOKEN', 'wrong')).toBe('');

        if (saved !== undefined) process.env.DISCORD_BOT_TOKEN = saved;
    });

    it('returns empty string for unknown key', () => {
        expect(resolve('NOT_A_THING')).toBe('');
    });
});

describe('resolveAll', () => {
    it('returns all keys with defaults', () => {
        const saved = { ...process.env };
        // Clear relevant env vars so defaults show
        for (const key of getKnownKeys()) delete process.env[key];

        const all = resolveAll();
        expect(Object.keys(all).length).toBe(getKnownKeys().length);
        expect(all['AGENT_TYPE']).toBe('claude');
        // Secrets without password show as empty
        expect(all['DISCORD_BOT_TOKEN']).toBe('');

        // Restore env
        for (const [k, v] of Object.entries(saved)) {
            if (v !== undefined) process.env[k] = v;
        }
    });

    it('masks secrets in env when no password', () => {
        process.env.DISCORD_BOT_TOKEN = 'should-be-masked';
        const all = resolveAll();
        expect(all['DISCORD_BOT_TOKEN']).toBe('***');
        delete process.env.DISCORD_BOT_TOKEN;
    });
});

// --- Import .env ---

describe('importDotEnv', () => {
    it('imports known keys from .env file', () => {
        const envPath = join(TEST_DIR, 'test.env');
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(envPath, [
            '# Comment line',
            'AGENT_TYPE=opencode',
            'REDIS_PORT="6380"',
            "DISCORD_BOT_TOKEN='my-secret-token'",
            '',
        ].join('\n'));

        const result = importDotEnv(envPath, PASSWORD);
        expect(result.imported).toContain('AGENT_TYPE');
        expect(result.imported).toContain('REDIS_PORT');
        expect(result.imported).toContain('DISCORD_BOT_TOKEN');

        // Verify written correctly
        const prefs = readPreferences();
        expect(prefs['AGENT_TYPE']).toBe('opencode');
        expect(prefs['REDIS_PORT']).toBe('6380');

        const secrets = readSecrets(PASSWORD);
        expect(secrets['DISCORD_BOT_TOKEN']).toBe('my-secret-token');
    });

    it('skips unknown keys', () => {
        const envPath = join(TEST_DIR, 'test.env');
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(envPath, 'UNKNOWN_VAR=hello\n');

        const result = importDotEnv(envPath, PASSWORD);
        expect(result.skipped).toContain('UNKNOWN_VAR');
        expect(result.imported).toHaveLength(0);
    });

    it('skips empty/placeholder values', () => {
        const envPath = join(TEST_DIR, 'test.env');
        mkdirSync(TEST_DIR, { recursive: true });
        writeFileSync(envPath, [
            'AGENT_TYPE=',
            'DISCORD_BOT_TOKEN=your-bot-token-here',
        ].join('\n'));

        const result = importDotEnv(envPath, PASSWORD);
        expect(result.skipped).toContain('AGENT_TYPE');
        expect(result.skipped).toContain('DISCORD_BOT_TOKEN');
        expect(result.imported).toHaveLength(0);
    });

    it('throws on missing file', () => {
        expect(() => importDotEnv('/nonexistent/.env', PASSWORD)).toThrow('File not found');
    });
});
