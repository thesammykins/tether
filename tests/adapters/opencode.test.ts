import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenCodeAdapter } from '../../src/adapters/opencode.js';

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    adapter = new OpenCodeAdapter();
  });

  it('should have name "opencode"', () => {
    expect(adapter.name).toBe('opencode');
  });

  it('should construct correct CLI args for new session', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ output: 'test response', sessionId: 'auto-gen-123' }));
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
        sessionId: 'initial-session',
        resume: false,
      });

      expect(mockSpawn).toHaveBeenCalled();
      const [args] = mockSpawn.mock.calls[0];

      expect(args).toContain('opencode');
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
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ output: 'resumed response' }));
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

      expect(args).toContain('--session');
      expect(args).toContain('existing-session');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should use working directory when provided', async () => {
    const mockSpawn = mock((args: string[], options: any) => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ output: 'response' }));
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

      const [args, options] = mockSpawn.mock.calls[0];
      
      expect(args).toContain('--cwd');
      expect(args).toContain('/custom/path');
      expect(options.cwd).toBe('/custom/path');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should parse JSON output and extract response', async () => {
    const mockSpawn = mock(() => ({
      stdout: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode(JSON.stringify({ output: 'parsed response' }));
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
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });

  it('should extract auto-generated session ID from response', async () => {
    const mockSpawn = mock(() => ({
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
    }));

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
      ).rejects.toThrow('OpenCode CLI failed');
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
  });
});
