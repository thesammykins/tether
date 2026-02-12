import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  let originalSpawn: typeof Bun.spawn;
  let consoleLogSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    originalSpawn = Bun.spawn;
    
    // Suppress console output in tests
    consoleLogSpy = mock(() => {});
    consoleWarnSpy = mock(() => {});
    console.log = consoleLogSpy;
    console.warn = consoleWarnSpy;
  });

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
    delete process.env.CLAUDE_BIN;
  });

  it('should have name "claude"', () => {
    expect(adapter.name).toBe('claude');
  });

  it('should resolve binary path using which', async () => {
    // Use a path that actually exists so existsSync validation passes
    const mockClaudePath = join(process.cwd(), 'bin', 'tether.ts');
    const mockSpawn = mock((args: string[], options?: any) => {
      // which/where claude
      if ((args[0] === 'which' || args[0] === 'where.exe') && args[1] === 'claude') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(`${mockClaudePath}\n`);
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }
      // claude --version
      if (args.includes('--version')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('1.0.70\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }
      // actual spawn
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'test' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
    });

    expect(consoleLogSpy.mock.calls.some((call: any[]) => 
      call[0]?.includes('Binary resolved')
    )).toBe(true);
  });

  it('should warn about known buggy versions', async () => {
    // Use a path that actually exists so existsSync validation passes
    const mockClaudePath = join(process.cwd(), 'bin', 'tether.ts');
    const mockSpawn = mock((args: string[], options?: any) => {
      // which/where claude
      if ((args[0] === 'which' || args[0] === 'where.exe') && args[1] === 'claude') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(`${mockClaudePath}\n`);
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }
      // claude --version (buggy version)
      if (args.includes('--version')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('1.0.67\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }
      // actual spawn
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'test' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
    });

    expect(consoleWarnSpy.mock.calls.some((call: any[]) => 
      call[0]?.includes('known issues with --resume')
    )).toBe(true);
  });

  it('should construct correct CLI args for new session', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'test response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test prompt',
      sessionId: 'test-session-123',
      resume: false,
    });

    expect(mockSpawn).toHaveBeenCalled();
    
    // Find the main spawn call (not which/version checks)
    const mainCall = mockSpawn.mock.calls.find((call: any[]) => 
      call[0].includes('--print')
    );
    
    expect(mainCall).toBeDefined();
    const [args] = mainCall!;

    expect(args).toContain('--print');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--session-id');
    expect(args).toContain('test-session-123');
    expect(args).toContain('-p');
    expect(args).toContain('test prompt');
  });

  it('should construct correct CLI args for resume session', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'resumed response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'follow up',
      sessionId: 'existing-session',
      resume: true,
    });

    // Find the main spawn call
    const mainCall = mockSpawn.mock.calls.find((call: any[]) => 
      call[0].includes('--resume') || call[0].includes('--print')
    );
    
    expect(mainCall).toBeDefined();
    const [args] = mainCall!;

    expect(args).toContain('--resume');
    expect(args).toContain('existing-session');
    expect(args).not.toContain('--session-id');
  });

  it('should fall back to --continue when --resume fails', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      // First call: --resume fails
      if (args.includes('--resume')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {},
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('Error: No conversation found for session');
            },
          },
          exited: Promise.resolve(1),
        };
      }
      // Second call: --continue succeeds
      if (args.includes('--continue')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode(JSON.stringify({ response: 'continued response' }));
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }
      // Default for which/version
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode('success\n');
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    const result = await adapter.spawn({
      prompt: 'follow up',
      sessionId: 'missing-session',
      resume: true,
    });

    // Should have called with --continue
    const continueCall = mockSpawn.mock.calls.find((call: any[]) => 
      call[0].includes('--continue')
    );
    
    expect(continueCall).toBeDefined();
    expect(result.output).toBe('continued response');

    // Should have logged the fallback
    expect(consoleLogSpy.mock.calls.some((call: any[]) => 
      call[0]?.includes('falling back to --continue')
    )).toBe(true);
  });

  it('should include system prompt when provided', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
      systemPrompt: 'You are a helpful assistant',
    });

    // Find the main spawn call
    const mainCall = mockSpawn.mock.calls.find((call: any[]) => 
      call[0].includes('--append-system-prompt')
    );
    
    expect(mainCall).toBeDefined();
    const [args] = mainCall!;

    expect(args).toContain('--append-system-prompt');
    const systemPromptIndex = args.indexOf('--append-system-prompt');
    const systemPromptValue = args[systemPromptIndex + 1];
    expect(systemPromptValue).toContain('You are a helpful assistant');
  });

  it('should use working directory when provided', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
      workingDir: '/custom/path',
    });

    // Find the main spawn call
    const mainCall = mockSpawn.mock.calls.find((call: any[]) => 
      call[0].includes('--print')
    );
    
    expect(mainCall).toBeDefined();
    const [, options] = mainCall!;
    expect(options.cwd).toBe('/custom/path');
  });

  it('should parse JSON output and extract response', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'parsed response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    const result = await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
    });

    expect(result.output).toBe('parsed response');
    expect(result.sessionId).toBe('sess');
  });

  it('should prefer CLAUDE_BIN when set', async () => {
    process.env.CLAUDE_BIN = '/custom/claude';
    const mockSpawn = mock((args: string[], options?: any) => {
      if (args.includes('--version')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('1.0.70\n');
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
            yield new TextEncoder().encode(JSON.stringify({ response: 'env response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
    });

    const spawnCall = mockSpawn.mock.calls.findLast((call: any[]) =>
      Array.isArray(call[0]) && call[0].includes('--print')
    );

    expect(spawnCall?.[0][0]).toBe('/custom/claude');
  });

  it('should handle non-JSON output', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
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

    (Bun as any).spawn = mockSpawn;

    const result = await adapter.spawn({
      prompt: 'test',
      sessionId: 'sess',
      resume: false,
    });

    expect(result.output).toBe('plain text response');
  });

  it('should throw error on non-zero exit code', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      // Let which/version succeed, but main call fails
      if (args.includes('--print')) {
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
      }
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode('ok');
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await expect(
      adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      })
    ).rejects.toThrow('Claude CLI failed');
  });

  it('should redact prompt in logs by default', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    await adapter.spawn({
      prompt: 'This is a very long prompt that should be redacted in logs',
      sessionId: 'sess',
      resume: false,
    });

    // Should log redacted version (char count + first 50)
    expect(consoleLogSpy.mock.calls.some((call: any[]) => 
      call[0]?.includes('Prompt:') && 
      call[0]?.includes('chars') && 
      call[0]?.includes('first 50:')
    )).toBe(true);

    // Should NOT log the full prompt
    expect(consoleLogSpy.mock.calls.some((call: any[]) => 
      call[0] === '[claude] Full prompt:'
    )).toBe(false);
  });

  it('should log full prompt when DEBUG env var is set', async () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = '1';

    const mockSpawn = mock((args: string[], options?: any) => {
      return {
        stdout: {
          [Symbol.asyncIterator]: async function* () {
            yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
          },
        },
        stderr: {
          [Symbol.asyncIterator]: async function* () {},
        },
        exited: Promise.resolve(0),
      };
    });

    (Bun as any).spawn = mockSpawn;

    const testPrompt = 'Secret test prompt';
    await adapter.spawn({
      prompt: testPrompt,
      sessionId: 'sess',
      resume: false,
    });

    // Should log full prompt with DEBUG=1
    expect(consoleLogSpy.mock.calls.some((call: any[]) => 
      call[0]?.includes('Full prompt:') && call[1] === testPrompt
    )).toBe(true);

    // Restore
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  it('should provide helpful diagnostics when spawn fails', async () => {
    process.env.CLAUDE_BIN = join(process.cwd(), 'tmp', 'missing-claude-binary');
    const mockSpawn = mock((args: string[]) => {
      if (args.includes('--version')) {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('1.0.70\n');
            },
          },
          stderr: {
            [Symbol.asyncIterator]: async function* () {},
          },
          exited: Promise.resolve(0),
        };
      }

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
    expect(message).toContain('Claude CLI failed to start');
    expect(message).toContain('CLAUDE_BIN');
    expect(message).toContain('Binary not found at the resolved path');
  });
});
