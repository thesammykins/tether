import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { formatSpawnError } from '../../src/adapters/spawn-diagnostics.js';

const TMP_ROOT = join(process.cwd(), 'tmp');

describe('spawn diagnostics', () => {
  let testDir: string;

  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    testDir = mkdtempSync(join(TMP_ROOT, 'spawn-diagnostics-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function makeError(code: string): Error {
    const err = new Error(`${code}: spawn failed`);
    (err as any).code = code;
    return err;
  }

  it('includes missing binary hint for ENOENT', () => {
    const binaryPath = join(testDir, 'missing-opencode');
    const message = formatSpawnError({
      adapterName: 'OpenCode',
      binaryPath,
      binarySource: 'env',
      envVar: 'OPENCODE_BIN',
      workingDir: join(testDir, 'missing-cwd'),
      args: [binaryPath, 'run', '--format', 'json', 'prompt'],
      error: makeError('ENOENT'),
    }).message;

    expect(message).toContain('OpenCode CLI failed to start');
    expect(message).toContain('Binary not found at the resolved path');
    expect(message).toContain('cwd:');
    expect(message).toContain('cmd:');
  });

  it('flags non-executable binaries', () => {
    const binaryPath = join(testDir, 'non-exec');
    writeFileSync(binaryPath, '#!/usr/bin/env node\n');
    chmodSync(binaryPath, 0o644);

    const message = formatSpawnError({
      adapterName: 'OpenCode',
      binaryPath,
      binarySource: 'candidate',
      envVar: 'OPENCODE_BIN',
      error: makeError('ENOENT'),
    }).message;

    if (process.platform !== 'win32') {
      expect(message).toContain('not executable');
    }
  });

  it('surfaces shebang details and PATH hints', () => {
    const binaryPath = join(testDir, 'shebang-node');
    writeFileSync(binaryPath, '#!/usr/bin/env node\n');
    chmodSync(binaryPath, 0o755);

    const message = formatSpawnError({
      adapterName: 'OpenCode',
      binaryPath,
      binarySource: 'path',
      envVar: 'OPENCODE_BIN',
      error: makeError('ENOENT'),
    }).message;

    if (process.platform !== 'win32') {
      expect(message).toContain('Shebang: /usr/bin/env node');
      expect(message).toContain('Ensure node is on PATH');
    }
    expect(message).toContain('resolved from PATH');
  });

  it('reports missing interpreters for absolute shebangs', () => {
    const binaryPath = join(testDir, 'shebang-missing');
    writeFileSync(binaryPath, '#!/no/such/interpreter\n');
    chmodSync(binaryPath, 0o755);

    const message = formatSpawnError({
      adapterName: 'OpenCode',
      binaryPath,
      binarySource: 'candidate',
      envVar: 'OPENCODE_BIN',
      error: makeError('ENOENT'),
    }).message;

    if (process.platform !== 'win32') {
      expect(message).toContain('Interpreter not found');
    }
  });
});
