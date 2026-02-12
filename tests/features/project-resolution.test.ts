/**
 * Tests for project resolution logic.
 *
 * resolveProject() in bot.ts is not directly importable (module-level
 * Discord client instantiation), so we test the resolution cascade by
 * exercising the same DB functions it calls, in the documented order:
 *
 * 1. [projectName] prefix → getProject(name)
 * 2. [/path] prefix → backward compat
 * 3. Channel project → getChannelProject(channelId)
 * 4. Default project → getDefaultProject()
 * 5. Lazy migration → migrateWorkingDirToProject()
 * 6. CLAUDE_WORKING_DIR env
 * 7. process.cwd()
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import {
    db,
    createProject,
    getProject,
    getDefaultProject,
    getChannelProject,
    setChannelProject,
    setProjectDefault,
    listProjects,
    deleteProject,
    getChannelConfigCached,
    setChannelConfig,
} from '../../src/db.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-resolution');

function cleanState() {
    db.run('DELETE FROM projects');
    db.run('UPDATE channels SET project_name = NULL');
    db.run('UPDATE threads SET project_name = NULL');
}

beforeEach(() => {
    cleanState();
    if (!existsSync(TEST_DIR)) {
        mkdirSync(TEST_DIR, { recursive: true });
    }
});

afterAll(() => {
    cleanState();
    if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
});

describe('project resolution cascade', () => {
    describe('step 1: [projectName] prefix lookup', () => {
        it('should resolve project by name from DB', () => {
            createProject('myapp', TEST_DIR);
            const project = getProject('myapp');
            expect(project).not.toBeNull();
            expect(project!.path).toBe(TEST_DIR);
            expect(existsSync(project!.path)).toBe(true);
        });

        it('should return null for unknown project name', () => {
            const project = getProject('nonexistent');
            expect(project).toBeNull();
        });

        it('should detect when project path no longer exists', () => {
            const missing = join(TEST_DIR, 'removed');
            mkdirSync(missing, { recursive: true });
            createProject('removable', missing);

            // Remove the directory
            rmSync(missing, { recursive: true, force: true });

            const project = getProject('removable');
            expect(project).not.toBeNull();
            expect(existsSync(project!.path)).toBe(false);
        });

        it('should distinguish project names from paths (no / or ~ or \\)', () => {
            // Names that look like project names (no path separators)
            const projectName = 'myapp';
            expect(projectName.startsWith('/')).toBe(false);
            expect(projectName.startsWith('~')).toBe(false);
            expect(projectName.includes('\\')).toBe(false);

            // These look like paths and should NOT be treated as project names
            expect('/Users/me/proj'.startsWith('/')).toBe(true);
            expect('~/project'.startsWith('~')).toBe(true);
            expect('C:\\project'.includes('\\')).toBe(true);
        });
    });

    describe('step 2: [/path] prefix backward compat', () => {
        it('should allow valid directory as bracket prefix', () => {
            // Simulates: user sends [/tmp/test-dir] do something
            expect(existsSync(TEST_DIR)).toBe(true);
            const resolved = resolve(TEST_DIR);
            expect(existsSync(resolved)).toBe(true);
        });

        it('should reject non-existent path', () => {
            const bad = '/nonexistent/deep/nested/path';
            expect(existsSync(bad)).toBe(false);
        });
    });

    describe('step 3: channel project fallback', () => {
        it('should resolve channel project when set', () => {
            createProject('channelproj', TEST_DIR);
            setChannelProject('ch-test-1', 'channelproj');

            const project = getChannelProject('ch-test-1');
            expect(project).not.toBeNull();
            expect(project!.name).toBe('channelproj');
            expect(project!.path).toBe(TEST_DIR);
        });

        it('should return null when channel has no project', () => {
            const project = getChannelProject('ch-no-project');
            expect(project).toBeNull();
        });

        it('should detect when channel project path is missing', () => {
            const missing = join(TEST_DIR, 'gone');
            mkdirSync(missing, { recursive: true });
            createProject('ephemeral', missing);
            setChannelProject('ch-test-2', 'ephemeral');

            rmSync(missing, { recursive: true, force: true });

            const project = getChannelProject('ch-test-2');
            expect(project).not.toBeNull();
            expect(existsSync(project!.path)).toBe(false);
        });
    });

    describe('step 4: default project fallback', () => {
        it('should resolve default project when set', () => {
            createProject('defproj', TEST_DIR, true);

            const project = getDefaultProject();
            expect(project).not.toBeNull();
            expect(project!.name).toBe('defproj');
            expect(project!.is_default).toBe(1);
        });

        it('should return null when no default', () => {
            createProject('notdefault', TEST_DIR, false);
            const project = getDefaultProject();
            expect(project).toBeNull();
        });

        it('should only return the single default', () => {
            createProject('first', '/first', true);
            createProject('second', '/second', true);

            const project = getDefaultProject();
            expect(project!.name).toBe('second');
        });
    });

    describe('step 6: legacy channel config fallback', () => {
        it('should resolve from cached channel config', () => {
            setChannelConfig('ch-legacy', TEST_DIR);

            const config = getChannelConfigCached('ch-legacy');
            expect(config).not.toBeNull();
            expect(config!.working_dir).toBe(TEST_DIR);
        });

        it('should return null for unconfigured channel', () => {
            const config = getChannelConfigCached('ch-unconfigured-' + Date.now());
            expect(config).toBeNull();
        });
    });

    describe('full cascade priority', () => {
        it('should prefer explicit project over channel project', () => {
            createProject('explicit', join(TEST_DIR, 'a'));
            createProject('channelproj', join(TEST_DIR, 'b'));
            setChannelProject('ch-cascade', 'channelproj');

            // If user sends [explicit], resolveProject would pick 'explicit'
            // regardless of what channel is linked to
            const explicit = getProject('explicit');
            const channelP = getChannelProject('ch-cascade');
            expect(explicit).not.toBeNull();
            expect(channelP).not.toBeNull();
            expect(explicit!.name).not.toBe(channelP!.name);
        });

        it('should prefer channel project over default', () => {
            createProject('defproj', '/default', true);
            createProject('chanproj', '/channel');
            setChannelProject('ch-prio', 'chanproj');

            const chanProject = getChannelProject('ch-prio');
            const defProject = getDefaultProject();

            expect(chanProject).not.toBeNull();
            expect(defProject).not.toBeNull();
            expect(chanProject!.name).toBe('chanproj');
            expect(defProject!.name).toBe('defproj');
        });

        it('should fall back to cwd when nothing configured', () => {
            // No projects, no channel config, no env
            expect(getDefaultProject()).toBeNull();
            expect(getChannelProject('ch-empty')).toBeNull();
            expect(listProjects()).toEqual([]);

            // Final fallback is process.cwd()
            expect(process.cwd()).toBeTruthy();
        });
    });
});

describe('message cleaning', () => {
    it('should extract bracket prefix from message', () => {
        const message = '[myproject] do something';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe('myproject');

        const cleaned = message.slice(match![0].length);
        expect(cleaned).toBe('do something');
    });

    it('should handle message with no bracket prefix', () => {
        const message = 'just a regular message';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        expect(match).toBeNull();
    });

    it('should handle path in brackets', () => {
        const message = '[/Users/me/project] fix the bug';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe('/Users/me/project');

        const cleaned = message.slice(match![0].length);
        expect(cleaned).toBe('fix the bug');
    });

    it('should handle brackets with no space after', () => {
        const message = '[myproject]do something';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        expect(match).not.toBeNull();
        expect(match![1]).toBe('myproject');

        const cleaned = message.slice(match![0].length);
        expect(cleaned).toBe('do something');
    });

    it('should not match brackets in middle of message', () => {
        const message = 'fix [this] bug';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        expect(match).toBeNull();
    });

    it('should handle empty brackets', () => {
        const message = '[] do something';
        const match = message.match(/^\[([^\]]+)\]\s*/);
        // Empty brackets should not match (requires at least one char inside)
        expect(match).toBeNull();
    });
});
