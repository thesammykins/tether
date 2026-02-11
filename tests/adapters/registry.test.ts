import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getAdapter, getSupportedAdapters } from '../../src/adapters/registry.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import { OpenCodeAdapter } from '../../src/adapters/opencode.js';
import { CodexAdapter } from '../../src/adapters/codex.js';

describe('Registry', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.AGENT_TYPE;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENT_TYPE;
    } else {
      process.env.AGENT_TYPE = originalEnv;
    }
  });

  describe('getAdapter', () => {
    it('should return ClaudeAdapter when type is "claude"', () => {
      const adapter = getAdapter('claude');
      expect(adapter).toBeInstanceOf(ClaudeAdapter);
      expect(adapter.name).toBe('claude');
    });

    it('should return OpenCodeAdapter when type is "opencode"', () => {
      const adapter = getAdapter('opencode');
      expect(adapter).toBeInstanceOf(OpenCodeAdapter);
      expect(adapter.name).toBe('opencode');
    });

    it('should return CodexAdapter when type is "codex"', () => {
      const adapter = getAdapter('codex');
      expect(adapter).toBeInstanceOf(CodexAdapter);
      expect(adapter.name).toBe('codex');
    });

    it('should be case-insensitive', () => {
      const adapter1 = getAdapter('CLAUDE');
      const adapter2 = getAdapter('OpenCode');
      const adapter3 = getAdapter('CoDex');

      expect(adapter1).toBeInstanceOf(ClaudeAdapter);
      expect(adapter2).toBeInstanceOf(OpenCodeAdapter);
      expect(adapter3).toBeInstanceOf(CodexAdapter);
    });

    it('should use AGENT_TYPE env var when type not provided', () => {
      process.env.AGENT_TYPE = 'opencode';
      const adapter = getAdapter();
      expect(adapter).toBeInstanceOf(OpenCodeAdapter);
    });

    it('should default to claude when no type or env var', () => {
      delete process.env.AGENT_TYPE;
      const adapter = getAdapter();
      expect(adapter).toBeInstanceOf(ClaudeAdapter);
    });

    it('should throw error for unknown adapter type', () => {
      expect(() => getAdapter('unknown')).toThrow('Unknown adapter type: unknown');
    });

    it('should default to claude for empty string', () => {
      delete process.env.AGENT_TYPE;
      const adapter = getAdapter('');
      expect(adapter).toBeInstanceOf(ClaudeAdapter);
    });
  });

  describe('getSupportedAdapters', () => {
    it('should return list of supported adapter names', () => {
      const adapters = getSupportedAdapters();
      expect(adapters).toEqual(['claude', 'opencode', 'codex']);
    });

    it('should return array', () => {
      const adapters = getSupportedAdapters();
      expect(Array.isArray(adapters)).toBe(true);
    });

    it('should contain exactly 3 adapters', () => {
      const adapters = getSupportedAdapters();
      expect(adapters.length).toBe(3);
    });
  });
});
