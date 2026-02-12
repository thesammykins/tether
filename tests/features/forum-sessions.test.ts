/**
 * Tests for forum session support
 *
 * Verifies:
 * - FORUM_SESSIONS / FORUM_CHANNEL_ID config keys exist and resolve correctly
 * - Forum thread IDs work with the existing thread→session DB mapping
 * - Module path resolution in bin/tether.ts start() uses package root
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import {
    setConfigDir, writePreference, resolve as resolveConfig,
    isKnownKey, getKeyMeta,
} from '../../src/config';

// Set test database path before importing db
const testDbPath = './data/test-forum-sessions.db';
process.env.DB_PATH = testDbPath;

import { db } from '../../src/db';

const TEST_CONFIG_DIR = join(process.cwd(), '.tmp-test-forum-config');

beforeEach(() => {
    db.run('DELETE FROM threads');
    setConfigDir(TEST_CONFIG_DIR);
});

afterAll(() => {
    try {
        if (existsSync(testDbPath)) unlinkSync(testDbPath);
    } catch {}
    try {
        const { rmSync } = require('fs');
        rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    } catch {}
});

describe('forum session config keys', () => {
    test('FORUM_SESSIONS is a known config key', () => {
        expect(isKnownKey('FORUM_SESSIONS')).toBe(true);
    });

    test('FORUM_CHANNEL_ID is a known config key', () => {
        expect(isKnownKey('FORUM_CHANNEL_ID')).toBe(true);
    });

    test('FORUM_SESSIONS defaults to false', () => {
        const meta = getKeyMeta('FORUM_SESSIONS');
        expect(meta).toBeDefined();
        expect(meta!.default).toBe('false');
        expect(meta!.section).toBe('features');
    });

    test('FORUM_CHANNEL_ID defaults to empty', () => {
        const meta = getKeyMeta('FORUM_CHANNEL_ID');
        expect(meta).toBeDefined();
        expect(meta!.default).toBe('');
        expect(meta!.section).toBe('features');
    });

    test('FORUM_SESSIONS resolves from env', () => {
        const original = process.env.FORUM_SESSIONS;
        process.env.FORUM_SESSIONS = 'true';
        expect(resolveConfig('FORUM_SESSIONS')).toBe('true');
        // Restore
        if (original === undefined) delete process.env.FORUM_SESSIONS;
        else process.env.FORUM_SESSIONS = original;
    });

    test('FORUM_CHANNEL_ID resolves from env', () => {
        const original = process.env.FORUM_CHANNEL_ID;
        process.env.FORUM_CHANNEL_ID = '1471316109381599305';
        expect(resolveConfig('FORUM_CHANNEL_ID')).toBe('1471316109381599305');
        // Restore
        if (original === undefined) delete process.env.FORUM_CHANNEL_ID;
        else process.env.FORUM_CHANNEL_ID = original;
    });
});

describe('forum thread session reuse', () => {
    test('forum thread ID maps to session like regular threads', () => {
        const forumThreadId = 'forum-thread-123456';
        const sessionId = 'session-abc-def';

        db.run(
            'INSERT INTO threads (thread_id, session_id) VALUES (?, ?)',
            [forumThreadId, sessionId],
        );

        const mapping = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get(forumThreadId) as { session_id: string } | null;

        expect(mapping).toBeDefined();
        expect(mapping!.session_id).toBe(sessionId);
    });

    test('multiple forum threads tracked independently', () => {
        const thread1 = 'forum-thread-111';
        const thread2 = 'forum-thread-222';

        db.run('INSERT INTO threads (thread_id, session_id) VALUES (?, ?)', [thread1, 'session-1']);
        db.run('INSERT INTO threads (thread_id, session_id) VALUES (?, ?)', [thread2, 'session-2']);

        const m1 = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get(thread1) as { session_id: string };
        const m2 = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get(thread2) as { session_id: string };

        expect(m1.session_id).toBe('session-1');
        expect(m2.session_id).toBe('session-2');
    });

    test('session update works for forum threads', () => {
        const forumThreadId = 'forum-thread-update';
        const originalSession = 'session-old';
        const newSession = 'session-new';

        db.run('INSERT INTO threads (thread_id, session_id) VALUES (?, ?)',
            [forumThreadId, originalSession]);

        db.run('UPDATE threads SET session_id = ? WHERE thread_id = ?',
            [newSession, forumThreadId]);

        const mapping = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get(forumThreadId) as { session_id: string };

        expect(mapping.session_id).toBe(newSession);
    });

    test('unknown forum thread returns null', () => {
        const mapping = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get('nonexistent-forum-thread');

        expect(mapping).toBeNull();
    });
});

describe('tether start module resolution', () => {
    test('bin/tether.ts uses dirname(import.meta.dir) for package root', async () => {
        // Read the source and verify it resolves paths from the package root
        const tetherSource = await Bun.file(join(process.cwd(), 'bin', 'tether.ts')).text();

        // Verify the start function uses packageRoot-relative paths
        expect(tetherSource).toContain('dirname(import.meta.dir)');
        expect(tetherSource).toContain("join(packageRoot, 'src', 'bot.ts')");
        expect(tetherSource).toContain("join(packageRoot, 'src', 'worker.ts')");

        // Verify it does NOT use relative 'src/bot.ts' strings in spawn
        expect(tetherSource).not.toContain("'bun', 'run', 'src/bot.ts'");
        expect(tetherSource).not.toContain("'bun', 'run', 'src/worker.ts'");
    });

    test('package root resolves to correct directory', () => {
        // import.meta.dir for this test file is tests/features/
        // dirname of that is tests/, dirname of that is project root
        const testDir = dirname(import.meta.dir);
        const projectRoot = dirname(testDir);

        // The package root should contain src/bot.ts and src/worker.ts
        expect(existsSync(join(projectRoot, 'src', 'bot.ts'))).toBe(true);
        expect(existsSync(join(projectRoot, 'src', 'worker.ts'))).toBe(true);
        expect(existsSync(join(projectRoot, 'bin', 'tether.ts'))).toBe(true);
    });
});
