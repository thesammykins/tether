import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
  });

  it('should have name "claude"', () => {
    expect(adapter.name).toBe('claude');
  });

  it('should construct correct CLI args for new session', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ response: 'test response' }));
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
        prompt: 'test prompt',
        sessionId: 'test-session-123',
        resume: false,
      });

      expect(mockSpawn).toHaveBeenCalled();
      const [args, options] = mockSpawn.mock.calls[0];

      expect(args).toContain('claude');
      expect(args).toContain('--print');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--session-id');
      expect(args).toContain('test-session-123');
      expect(args).toContain('-p');
      expect(args).toContain('test prompt');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should construct correct CLI args for resume session', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ response: 'resumed response' }));
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
        prompt: 'follow up',
        sessionId: 'existing-session',
        resume: true,
      });

      const [args] = mockSpawn.mock.calls[0];

      expect(args).toContain('--resume');
      expect(args).toContain('existing-session');
      expect(args).not.toContain('--session-id');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should include system prompt when provided', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
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
        systemPrompt: 'You are a helpful assistant',
      });

      const [args] = mockSpawn.mock.calls[0];

      expect(args).toContain('--append-system-prompt');
      const systemPromptIndex = args.indexOf('--append-system-prompt');
      const systemPromptValue = args[systemPromptIndex + 1];
      expect(systemPromptValue).toContain('You are a helpful assistant');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should use working directory when provided', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ response: 'response' }));
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
        workingDir: '/custom/path',
      });

      const [, options] = mockSpawn.mock.calls[0];
      expect(options.cwd).toBe('/custom/path');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should parse JSON output and extract response', async () => {
    const mockSpawn = mock(() => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ response: 'parsed response' }));
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
      const result = await adapter.spawn({
        prompt: 'test',
        sessionId: 'sess',
        resume: false,
      });

      expect(result.output).toBe('parsed response');
      expect(result.sessionId).toBe('sess');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should handle non-JSON output', async () => {
    const mockSpawn = mock(() => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode('plain text response');
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
    const mockSpawn = mock(() => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {},
      },
      stderr: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode('error message');
        },
      },
      exited: Promise.resolve(1),
    }));

    const originalSpawn = Bun.spawn;
    (Bun as any).spawn = mockSpawn;

    try {
      await expect(
        adapter.spawn({
          prompt: 'test',
          sessionId: 'sess',
          resume: false,
        })
      ).rejects.toThrow('Claude CLI failed');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });
});
