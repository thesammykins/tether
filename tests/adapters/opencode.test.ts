import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { OpenCodeAdapter, _resetBinaryCache } from '../../src/adapters/opencode.js';

// Use a path that exists on ALL platforms (macOS, Linux CI) for which mock results
const REAL_BIN_PATH = process.execPath;

/** Create a mock FileSink that captures written data */
function createMockStdin() {
  const chunks: string[] = [];
  return {
    write(data: string | Uint8Array) {
      chunks.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
    },
    end() {},
    flush() {},
    getWritten() { return chunks.join(''); },
    chunks,
  };
}

/** Build an NDJSON event stream like opencode run --format json produces */
function buildNdjsonOutput(text: string, sessionId: string): string {
  const events = [
    JSON.stringify({ type: 'step_start', sessionID: sessionId, timestamp: Date.now(), part: { id: 'prt_1', sessionID: sessionId, type: 'step-start' } }),
    JSON.stringify({ type: 'text', sessionID: sessionId, timestamp: Date.now(), part: { id: 'prt_2', sessionID: sessionId, type: 'text', text } }),
    JSON.stringify({ type: 'step_finish', sessionID: sessionId, timestamp: Date.now(), part: { id: 'prt_3', sessionID: sessionId, type: 'step-finish', reason: 'stop' } }),
  ];
  return events.join('\n') + '\n';
}

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
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('test response', 'ses_auto123'));
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
      const [args, options] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('run')
      ) ?? [[], {}];

      expect(args[0]).toBe(REAL_BIN_PATH);
      expect(args).toContain('run');
      expect(args).toContain('--format');
      expect(args).toContain('json');
      expect(args).not.toContain('--session');
      // Prompt is piped via stdin, NOT in args
      expect(args).not.toContain('test prompt');
      expect(stdinMock.getWritten()).toBe('test prompt');
      // stdin: 'pipe' is requested
      expect((options as Record<string, unknown>).stdin).toBe('pipe');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should construct correct CLI args for resume session', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('resumed response', 'ses_existing'));
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
      expect(stdinMock.getWritten()).toBe('follow up');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should use working directory via cwd option (no --cwd flag)', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('response', 'ses_123'));
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
      
      // No --cwd flag (not supported by opencode run)
      expect(args).not.toContain('--cwd');
      // Working directory set via Bun.spawn cwd option
      expect((options as Record<string, unknown>).cwd).toBe('/custom/path');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should parse NDJSON event stream and extract text', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('parsed response', 'ses_parsed'));
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
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => ({
      stdin: stdinMock,
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(buildNdjsonOutput('env response', 'ses_env'));
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

  it('should extract session ID from NDJSON events', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('response', 'ses_auto456'));
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

      expect(result.sessionId).toBe('ses_auto456');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should handle non-JSON output gracefully', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
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

  it('should concatenate multiple text events from NDJSON stream', async () => {
    const stdinMock = createMockStdin();
    const multiTextNdjson = [
      JSON.stringify({ type: 'step_start', sessionID: 'ses_multi', part: { type: 'step-start' } }),
      JSON.stringify({ type: 'text', sessionID: 'ses_multi', part: { type: 'text', text: 'Hello ' } }),
      JSON.stringify({ type: 'text', sessionID: 'ses_multi', part: { type: 'text', text: 'World!' } }),
      JSON.stringify({ type: 'step_finish', sessionID: 'ses_multi', part: { type: 'step-finish' } }),
    ].join('\n');

    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(multiTextNdjson);
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

      expect(result.output).toBe('Hello World!');
      expect(result.sessionId).toBe('ses_multi');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should throw error on non-zero exit code', async () => {
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
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
    const stdinMock = createMockStdin();
    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
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

  it('should pipe multi-line prompt with XML tags via stdin', async () => {
    const stdinMock = createMockStdin();
    const xmlPrompt = `<channel_context source="discord" trust="untrusted">
Recent channel context:
user: hello
bot: Processing...
</channel_context>

what's your local system time?`;

    const mockSpawn = mock((args: string[], options: unknown) => {
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
        stdin: stdinMock,
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(buildNdjsonOutput('The time is 3:00 PM', 'ses_xml'));
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
        prompt: xmlPrompt,
        sessionId: 'sess',
        resume: false,
      });

      // Prompt should be sent via stdin, not in args
      const [args] = mockSpawn.mock.calls.findLast((call: any[]) =>
        Array.isArray(call[0]) && call[0].includes('run')
      ) ?? [[]];
      expect(args).not.toContain(xmlPrompt);
      expect(stdinMock.getWritten()).toBe(xmlPrompt);

      expect(result.output).toBe('The time is 3:00 PM');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });
});
