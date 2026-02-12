import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { OpenCodeAdapter, _resetBinaryCache } from '../../src/adapters/opencode.js';

// Use a path that exists on ALL platforms (macOS, Linux CI) for which mock results
const REAL_BIN_PATH = process.execPath;

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    _resetBinaryCache();
    adapter = new OpenCodeAdapter();
  });

  afterEach(() => {
    delete process.env.OPENCODE_BIN;
  });

  it('should have name "opencode"', () => {
    expect(adapter.name).toBe('opencode');
  });

  it('should construct correct CLI args for new session', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ output: 'test response', sessionId: 'auto-gen-123' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await adapter.spawn({
        prompt: 'test prompt',
        sessionId: 'initial-session',
        resume: false,
      });

      expect(mockSpawn).toHaveBeenCalled();
      const [args] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('run')
      ) ?? [[]];

      expect(args[0]).toBe(REAL_BIN_PATH);
      expect(args).toContain('run');
      expect(args).toContain('--format');
      expect(args).toContain('json');
      expect(args).toContain('test prompt');
      expect(args).not.toContain('--session');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should construct correct CLI args for resume session', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ output: 'resumed response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await adapter.spawn({
        prompt: 'follow up',
        sessionId: 'existing-session',
        resume: true,
      });

      const [args] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('run')
      ) ?? [[]];

      expect(args).toContain('--session');
      expect(args).toContain('existing-session');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should use working directory when provided', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ output: 'response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
        workingDir: '/custom/path',
      });

      const [args, options] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('run')
      ) ?? [[], {}];
      
      expect(args).toContain('--cwd');
      expect(args).toContain('/custom/path');
      expect(options.cwd).toBe('/custom/path');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should parse JSON output and extract response', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ output: 'parsed response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      const result = await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });

      expect(result.output).toBe('parsed response');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should prefer OPENCODE_BIN when set', async () => {
    process.env.OPENCODE_BIN = '/custom/opencode';
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ output: 'env response' }));
        },
      },
      stderr: {
        [Symbol.asyncIterator]: async function* () {},
      },
      exited: Promise.resolve(0),
    }));

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });

      const [args] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0][0] === '/custom/opencode'
      ) ?? [[]];

      expect(args[0]).toBe('/custom/opencode');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should extract auto-generated session ID from response', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ 
              output: 'response',
              sessionId: 'auto-generated-456'
            }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      const result = await adapter.spawn({
        prompt: 'test',
        sessionId: 'initial',
        resume: false,
      });

      expect(result.sessionId).toBe('auto-generated-456');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should handle non-JSON output', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode('plain text response');
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      const result = await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });

      expect(result.output).toBe('plain text response');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should throw error on non-zero exit code', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {},
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode('error message');
          },
        },
        exited: Promise.resolve(1),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await expect(
        adapter.spawn({
          prompt: 'test',
          sessionId: 'sess',
          resume: false,
        })
      ).rejects.toThrow('OpenCode CLI failed');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should provide helpful diagnostics when spawn fails', async () => {
    process.env.OPENCODE_BIN = join(process.cwd(), 'tmp', 'missing-opencode-binary');
    const mockSpawn = mock(() => {
      const err = new Error('ENOENT: no such file or directory, posix_spawn');
      (err as any).code = 'ENOENT';
      throw err;
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    let caught: unknown;
    try {
      await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });
    } catch (error) {
      caught = error;
    } finally {
      (Bun as any).spawn = originalSpawn;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('OpenCode CLI failed to start');
    expect(message).toContain('OPENCODE_BIN');
    expect(message).toContain('Binary not found at the resolved path');
  });

  it('should provide helpful diagnostics when async spawn fails (proc.exited rejection)', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(REAL_BIN_PATH + '\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

      // Simulate async rejection from proc.exited (e.g., ENOENT from shebang resolution)
      const err = new Error('ENOENT: no such file or directory');
      (err as any).code = 'ENOENT';
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {},
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.reject(err),
      };
    });

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    let caught: unknown;
    try {
      await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });
    } catch (error) {
      caught = error;
    } finally {
      (Bun as any).spawn = originalSpawn;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('OpenCode CLI failed to start');
    expect(message).toContain('ENOENT');
  });
});
