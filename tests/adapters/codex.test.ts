import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { CodexAdapter } from '../../src/adapters/codex.js';

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  afterEach(() => {
    delete process.env.CODEX_BIN;
  });

  it('should have name "codex"', () => {
    expect(adapter.name).toBe('codex');
  });

  it('should construct correct CLI args for new session', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
            yield new TextEncoder().encode(JSON.stringify({ output: 'test response', sessionId: 'auto-gen-789' }));
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
        Array.isArray(call[0]) && call[0].includes('exec')
      ) ?? [[]];

      expect(args[0]).toContain('codex');
      expect(args).toContain('exec');
      expect(args).toContain('--json');
      expect(args).toContain('test prompt');
      expect(args).not.toContain('resume');
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
        Array.isArray(call[0]) && call[0].includes('exec')
      ) ?? [[]];

      expect(args[0]).toContain('codex');
      expect(args).toContain('exec');
      expect(args).toContain('resume');
      expect(args).toContain('existing-session');
      expect(args).toContain('follow up');
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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

      const [, options] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('exec')
      ) ?? [[], {}];
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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

  it('should prefer CODEX_BIN when set', async () => {
    process.env.CODEX_BIN = '/custom/codex';
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
        Array.isArray(call[0]) && call[0][0] === '/custom/codex'
      ) ?? [[]];

      expect(args[0]).toBe('/custom/codex');
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
              sessionId: 'codex-auto-123'
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

      expect(result.sessionId).toBe('codex-auto-123');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should handle session_id with underscore', async () => {
    const mockSpawn = mock((args: string[], options: any) => {
      if (args[0] === 'which' || args[0] === 'where.exe') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
              session_id: 'snake-case-id'
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

      expect(result.sessionId).toBe('snake-case-id');
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
              yield new TextEncoder().encode('/usr/local/bin/codex\n');
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
      ).rejects.toThrow('Codex CLI failed');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });
});
