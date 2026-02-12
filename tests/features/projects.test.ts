/**
 * Tests for project management — DB CRUD layer and feature handlers.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import {
    db,
    createProject,
    getProject,
    getDefaultProject,
    listProjects,
    deleteProject,
    setProjectDefault,
    getChannelProject,
    setChannelProject,
    getThreadProject,
    setThreadProject,
} from '../../src/db.js';
import type { Project } from '../../src/db.js';
import {
    handleProjectAdd,
    handleProjectList,
    handleProjectDefault,
    handleProjectUse,
    handleSessionAttach,
    findSession,
    getRecentSessions,
} from '../../src/features/projects.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-projects');

function cleanProjectState() {
    db.run('DELETE FROM projects');
    db.run('UPDATE channels SET project_name = NULL');
    db.run('UPDATE threads SET project_name = NULL');
}

function ensureTestDir() {
    if (!existsSync(TEST_DIR)) {
        mkdirSync(TEST_DIR, { recursive: true });
    }
}

function cleanTestDir() {
    if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
}

beforeEach(() => {
    cleanProjectState();
    ensureTestDir();
});

// Clean up temp dir after all tests
import { afterAll } from 'bun:test';
afterAll(() => {
    cleanTestDir();
    cleanProjectState();
});

// --- DB CRUD ---

describe('createProject', () => {
    it('should create a project', () => {
        createProject('myapp', '/some/path');
        const project = getProject('myapp');
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
        expect(project!.path).toBe('/some/path');
        expect(project!.is_default).toBe(0);
    });

    it('should upsert on conflict (same name)', () => {
        createProject('myapp', '/old/path');
        createProject('myapp', '/new/path');

        const project = getProject('myapp');
        expect(project).not.toBeNull();
        expect(project!.path).toBe('/new/path');

        // Should still be only one project
        const all = listProjects();
        expect(all.length).toBe(1);
    });

    it('should set as default when isDefault=true', () => {
        createProject('myapp', '/some/path', true);
        const project = getProject('myapp');
        expect(project!.is_default).toBe(1);
    });

    it('should unset other defaults when setting new default', () => {
        createProject('first', '/first', true);
        createProject('second', '/second', true);

        const first = getProject('first');
        const second = getProject('second');
        expect(first!.is_default).toBe(0);
        expect(second!.is_default).toBe(1);
    });

    it('should not set default when isDefault is false or omitted', () => {
        createProject('myapp', '/path', false);
        const project = getProject('myapp');
        expect(project!.is_default).toBe(0);

        createProject('other', '/other');
        const other = getProject('other');
        expect(other!.is_default).toBe(0);
    });
});

describe('getProject', () => {
    it('should return project by name', () => {
        createProject('myapp', '/some/path');
        const project = getProject('myapp');
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
        expect(project!.path).toBe('/some/path');
        expect(project!.created_at).toBeTruthy();
    });

    it('should return null for non-existent project', () => {
        const project = getProject('nonexistent');
        expect(project).toBeNull();
    });
});

describe('getDefaultProject', () => {
    it('should return default project', () => {
        createProject('myapp', '/some/path', true);
        const project = getDefaultProject();
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
        expect(project!.is_default).toBe(1);
    });

    it('should return null when no default', () => {
        createProject('myapp', '/some/path', false);
        const project = getDefaultProject();
        expect(project).toBeNull();
    });

    it('should return null when no projects exist', () => {
        const project = getDefaultProject();
        expect(project).toBeNull();
    });
});

describe('listProjects', () => {
    it('should return all projects ordered by name', () => {
        createProject('zeta', '/z');
        createProject('alpha', '/a');
        createProject('beta', '/b');

        const projects = listProjects();
        expect(projects.length).toBe(3);
        expect(projects[0]!.name).toBe('alpha');
        expect(projects[1]!.name).toBe('beta');
        expect(projects[2]!.name).toBe('zeta');
    });

    it('should return empty array when no projects', () => {
        const projects = listProjects();
        expect(projects).toEqual([]);
    });
});

describe('deleteProject', () => {
    it('should delete project', () => {
        createProject('myapp', '/some/path');
        expect(getProject('myapp')).not.toBeNull();

        deleteProject('myapp');
        expect(getProject('myapp')).toBeNull();
    });

    it('should unlink from channels', () => {
        createProject('myapp', '/some/path');
        setChannelProject('ch-1', 'myapp');

        // Verify link exists
        const before = getChannelProject('ch-1');
        expect(before).not.toBeNull();

        deleteProject('myapp');

        const after = getChannelProject('ch-1');
        expect(after).toBeNull();
    });

    it('should unlink from threads', () => {
        createProject('myapp', '/some/path');

        // Insert a thread row first (setThreadProject updates, doesn't insert)
        db.run('INSERT OR IGNORE INTO threads (thread_id, session_id) VALUES (?, ?)', ['th-1', 'sess-1']);
        setThreadProject('th-1', 'myapp');

        // Verify link exists
        const before = getThreadProject('th-1');
        expect(before).not.toBeNull();

        deleteProject('myapp');

        const after = getThreadProject('th-1');
        expect(after).toBeNull();
    });

    it('should be a no-op for non-existent project', () => {
        // Should not throw
        deleteProject('nonexistent');
        expect(listProjects()).toEqual([]);
    });
});

describe('setProjectDefault', () => {
    it('should set a project as default', () => {
        createProject('myapp', '/path');
        setProjectDefault('myapp');

        const project = getProject('myapp');
        expect(project!.is_default).toBe(1);
    });

    it('should unset previous default', () => {
        createProject('first', '/first', true);
        createProject('second', '/second');

        setProjectDefault('second');

        expect(getProject('first')!.is_default).toBe(0);
        expect(getProject('second')!.is_default).toBe(1);
    });

    it('should handle being called on already-default project', () => {
        createProject('myapp', '/path', true);
        setProjectDefault('myapp');

        expect(getProject('myapp')!.is_default).toBe(1);
        expect(listProjects().filter(p => p.is_default === 1).length).toBe(1);
    });
});

// --- Channel-project linking ---

describe('channel-project linking', () => {
    it('should link channel to project', () => {
        createProject('myapp', '/some/path');
        setChannelProject('ch-1', 'myapp');

        const project = getChannelProject('ch-1');
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
        expect(project!.path).toBe('/some/path');
    });

    it('should get channel project', () => {
        createProject('myapp', '/some/path');
        setChannelProject('ch-1', 'myapp');

        const project = getChannelProject('ch-1');
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
    });

    it('should return null for unlinked channel', () => {
        const project = getChannelProject('ch-unlinked');
        expect(project).toBeNull();
    });

    it('should update channel project on re-link', () => {
        createProject('first', '/first');
        createProject('second', '/second');

        setChannelProject('ch-1', 'first');
        expect(getChannelProject('ch-1')!.name).toBe('first');

        setChannelProject('ch-1', 'second');
        expect(getChannelProject('ch-1')!.name).toBe('second');
    });

    it('should return null when linked project is deleted', () => {
        createProject('myapp', '/some/path');
        setChannelProject('ch-1', 'myapp');
        deleteProject('myapp');

        expect(getChannelProject('ch-1')).toBeNull();
    });
});

// --- Thread-project linking ---

describe('thread-project linking', () => {
    beforeEach(() => {
        // Insert thread rows for linking tests
        db.run('INSERT OR IGNORE INTO threads (thread_id, session_id) VALUES (?, ?)', ['th-1', 'sess-1']);
        db.run('INSERT OR IGNORE INTO threads (thread_id, session_id) VALUES (?, ?)', ['th-2', 'sess-2']);
    });

    it('should link thread to project', () => {
        createProject('myapp', '/some/path');
        setThreadProject('th-1', 'myapp');

        const project = getThreadProject('th-1');
        expect(project).not.toBeNull();
        expect(project!.name).toBe('myapp');
        expect(project!.path).toBe('/some/path');
    });

    it('should get thread project', () => {
        createProject('myapp', '/some/path');
        setThreadProject('th-1', 'myapp');

        const project = getThreadProject('th-1');
        expect(project).not.toBeNull();
    });

    it('should return null for unlinked thread', () => {
        const project = getThreadProject('th-unlinked');
        expect(project).toBeNull();
    });

    it('should return null when linked project is deleted', () => {
        createProject('myapp', '/some/path');
        setThreadProject('th-1', 'myapp');
        deleteProject('myapp');

        expect(getThreadProject('th-1')).toBeNull();
    });
});

// --- Feature handlers ---

describe('handleProjectAdd', () => {
    it('should create project with valid path', () => {
        const result = handleProjectAdd('testproj', TEST_DIR);
        expect(result.success).toBe(true);
        expect(result.message).toContain('testproj');
        expect(result.message).toContain('registered');

        const project = getProject('testproj');
        expect(project).not.toBeNull();
        expect(project!.path).toBe(resolve(TEST_DIR));
    });

    it('should reject non-existent path', () => {
        const result = handleProjectAdd('bad', '/nonexistent/dir/that/does/not/exist');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });

    it('should validate path exists', () => {
        const subdir = join(TEST_DIR, 'sub');
        mkdirSync(subdir, { recursive: true });

        const result = handleProjectAdd('sub', subdir);
        expect(result.success).toBe(true);

        const project = getProject('sub');
        expect(project).not.toBeNull();
    });
});

describe('handleProjectList', () => {
    it('should format project list', () => {
        createProject('alpha', '/alpha');
        createProject('beta', '/beta');

        const { projects, formatted } = handleProjectList();
        expect(projects.length).toBe(2);
        expect(formatted).toContain('alpha');
        expect(formatted).toContain('beta');
        expect(formatted).toContain('Registered Projects');
    });

    it('should show default marker', () => {
        createProject('alpha', '/alpha', true);
        createProject('beta', '/beta');

        const { formatted } = handleProjectList();
        expect(formatted).toContain('**(default)**');
        // Only alpha should be marked default
        const lines = formatted.split('\n');
        const alphaLine = lines.find(l => l.includes('alpha'));
        const betaLine = lines.find(l => l.includes('beta'));
        expect(alphaLine).toContain('(default)');
        expect(betaLine).not.toContain('(default)');
    });

    it('should handle empty list', () => {
        const { projects, formatted } = handleProjectList();
        expect(projects.length).toBe(0);
        expect(formatted).toContain('No projects registered');
    });
});

describe('handleProjectDefault', () => {
    it('should set existing project as default', () => {
        createProject('myapp', '/path');
        const result = handleProjectDefault('myapp');
        expect(result.success).toBe(true);
        expect(result.message).toContain('default');

        expect(getDefaultProject()!.name).toBe('myapp');
    });

    it('should reject non-existent project', () => {
        const result = handleProjectDefault('nope');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });
});

describe('handleProjectUse', () => {
    it('should bind existing project to channel', () => {
        createProject('myapp', '/path');
        const result = handleProjectUse('ch-1', 'myapp');
        expect(result.success).toBe(true);
        expect(result.message).toContain('myapp');

        const linked = getChannelProject('ch-1');
        expect(linked).not.toBeNull();
        expect(linked!.name).toBe('myapp');
    });

    it('should reject non-existent project', () => {
        const result = handleProjectUse('ch-1', 'nope');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
    });
});

// --- Session attach ---

describe('findSession', () => {
    beforeEach(() => {
        db.run('DELETE FROM threads WHERE thread_id LIKE ?', ['test-find-%']);
    });

    it('should find session by exact ID', () => {
        db.run('INSERT INTO threads (thread_id, session_id) VALUES (?, ?)', ['test-find-1', 'abc-123-def']);
        const result = findSession('abc-123-def');
        expect(result).not.toBeNull();
        expect(result!.session_id).toBe('abc-123-def');
        expect(result!.thread_id).toBe('test-find-1');
    });

    it('should find session by prefix', () => {
        db.run('INSERT INTO threads (thread_id, session_id) VALUES (?, ?)', ['test-find-2', 'abc-123-def-full-id']);
        const result = findSession('abc-123');
        expect(result).not.toBeNull();
        expect(result!.session_id).toBe('abc-123-def-full-id');
    });

    it('should return null for unknown session', () => {
        const result = findSession('nonexistent-session-id');
        expect(result).toBeNull();
    });
});

describe('handleSessionAttach', () => {
    beforeEach(() => {
        db.run('DELETE FROM threads WHERE thread_id LIKE ?', ['test-attach-%']);
    });

    it('should return session info for valid session', () => {
        db.run('INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
            ['test-attach-1', 'sess-abc-123', '/work/dir']);

        const result = handleSessionAttach('sess-abc-123');
        expect(result.success).toBe(true);
        expect(result.session).toBeDefined();
        expect(result.session!.session_id).toBe('sess-abc-123');
        expect(result.session!.working_dir).toBe('/work/dir');
    });

    it('should fail for unknown session', () => {
        const result = handleSessionAttach('nonexistent');
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
        expect(result.session).toBeUndefined();
    });
});

describe('getRecentSessions', () => {
    beforeEach(() => {
        // getRecentSessions queries ALL threads, so clean the whole table
        db.run('DELETE FROM threads');
    });

    it('should return recent sessions matching filter', () => {
        db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
            ['test-recent-1', 'sess-aaa', '2026-01-01 10:00:00']);
        db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
            ['test-recent-2', 'sess-bbb', '2026-01-02 10:00:00']);

        const results = getRecentSessions('sess');
        expect(results.length).toBe(2);
        expect(results[0]!.value).toBe('sess-bbb'); // Newest first
    });

    it('should filter by partial match', () => {
        db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
            ['test-recent-3', 'sess-aaa', '2026-01-01 10:00:00']);
        db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
            ['test-recent-4', 'other-bbb', '2026-01-02 10:00:00']);

        const results = getRecentSessions('sess');
        expect(results.length).toBe(1);
        expect(results[0]!.value).toBe('sess-aaa');
    });

    it('should respect limit', () => {
        for (let i = 0; i < 30; i++) {
            db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
                [`test-recent-lim-${i}`, `sess-${String(i).padStart(3, '0')}`, `2026-01-${String(i + 1).padStart(2, '0')} 10:00:00`]);
        }

        const results = getRecentSessions('sess', 5);
        expect(results.length).toBe(5);
    });

    it('should return empty for no matches', () => {
        db.run('INSERT INTO threads (thread_id, session_id, created_at) VALUES (?, ?, ?)',
            ['test-recent-5', 'sess-xyz', '2026-01-01 10:00:00']);

        const results = getRecentSessions('nomatch');
        expect(results.length).toBe(0);
    });
});
