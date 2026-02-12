/**
 * Tests for lazy migration from CLAUDE_WORKING_DIR to named projects.
 *
 * migrateWorkingDirToProject() in config.ts creates a default project
 * from CLAUDE_WORKING_DIR when no projects exist yet. It's a one-shot
 * migration — subsequent calls are no-ops.
 *
 * We redirect config.ts to a temp config dir so the real config.toml
 * (which may contain CLAUDE_WORKING_DIR) doesn't interfere.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import {
    db,
    createProject,
    getDefaultProject,
    listProjects,
} from '../../src/db.js';
import { migrateWorkingDirToProject, setConfigDir } from '../../src/config.js';

const TEST_DIR = join(process.cwd(), '.tmp-test-migration');
const SUB_DIR = join(TEST_DIR, 'my-cool-project');
const CONFIG_DIR = join(TEST_DIR, 'config');

function cleanState() {
    db.run('DELETE FROM projects');
    db.run('UPDATE channels SET project_name = NULL');
    db.run('UPDATE threads SET project_name = NULL');
}

beforeEach(() => {
    cleanState();
    // Ensure test directories exist
    if (!existsSync(SUB_DIR)) {
        mkdirSync(SUB_DIR, { recursive: true });
    }
    // Point config to an empty temp dir so real config.toml doesn't interfere
    if (existsSync(CONFIG_DIR)) {
        rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
    setConfigDir(CONFIG_DIR);
    // Clear CLAUDE_WORKING_DIR to start clean
    delete process.env.CLAUDE_WORKING_DIR;
});

afterAll(() => {
    cleanState();
    delete process.env.CLAUDE_WORKING_DIR;
    if (existsSync(TEST_DIR)) {
        rmSync(TEST_DIR, { recursive: true, force: true });
    }
});

describe('migrateWorkingDirToProject', () => {
    it('should create project from CLAUDE_WORKING_DIR when no projects exist', () => {
        process.env.CLAUDE_WORKING_DIR = SUB_DIR;

        migrateWorkingDirToProject();

        const projects = listProjects();
        expect(projects.length).toBe(1);
        expect(projects[0]!.path).toBe(resolve(SUB_DIR));
    });

    it('should not create project when projects already exist', () => {
        createProject('existing', '/some/path');
        process.env.CLAUDE_WORKING_DIR = SUB_DIR;

        migrateWorkingDirToProject();

        const projects = listProjects();
        expect(projects.length).toBe(1);
        expect(projects[0]!.name).toBe('existing');
    });

    it('should use directory basename as project name', () => {
        process.env.CLAUDE_WORKING_DIR = SUB_DIR;

        migrateWorkingDirToProject();

        const projects = listProjects();
        expect(projects.length).toBe(1);
        expect(projects[0]!.name).toBe(basename(SUB_DIR));
        expect(projects[0]!.name).toBe('my-cool-project');
    });

    it('should set migrated project as default', () => {
        process.env.CLAUDE_WORKING_DIR = SUB_DIR;

        migrateWorkingDirToProject();

        const defaultProject = getDefaultProject();
        expect(defaultProject).not.toBeNull();
        expect(defaultProject!.is_default).toBe(1);
        expect(defaultProject!.name).toBe('my-cool-project');
    });

    it('should be a no-op when CLAUDE_WORKING_DIR is not set', () => {
        delete process.env.CLAUDE_WORKING_DIR;

        migrateWorkingDirToProject();

        expect(listProjects()).toEqual([]);
    });

    it('should be idempotent — second call is a no-op', () => {
        process.env.CLAUDE_WORKING_DIR = SUB_DIR;

        migrateWorkingDirToProject();
        expect(listProjects().length).toBe(1);

        // Second call — projects already exist, should skip
        migrateWorkingDirToProject();
        expect(listProjects().length).toBe(1);
    });
});
