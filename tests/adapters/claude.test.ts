import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
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
  });

  it('should have name "claude"', () => {
    expect(adapter.name).toBe('claude');
  });

  it('should resolve binary path using which', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      // which claude
      if (args[0] === 'which' && args[1] === 'claude') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('/usr/local/bin/claude\n');
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
      call[0]?.includes('Binary found at')
    )).toBe(true);
  });

  it('should warn about known buggy versions', async () => {
    const mockSpawn = mock((args: string[], options?: any) => {
      // which claude
      if (args[0] === 'which' && args[1] === 'claude') {
        return {
          stdout: {
            [Symbol.asyncIterator]: async function* () {
              yield new TextEncoder().encode('/usr/local/bin/claude\n');
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
});
