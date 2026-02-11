import type { AgentAdapter } from './types.js';
import { ClaudeAdapter } from './claude.js';
import { OpenCodeAdapter } from './opencode.js';
import { CodexAdapter } from './codex.js';

export function getAdapter(type?: string): AgentAdapter {
  const adapterType = type || process.env.AGENT_TYPE || 'claude';
  
  switch (adapterType.toLowerCase()) {
    case 'claude':
      return new ClaudeAdapter();
    case 'opencode':
      return new OpenCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    default:
      throw new Error(`Unknown adapter type: ${adapterType}`);
  }
}

export function getSupportedAdapters(): string[] {
  return ['claude', 'opencode', 'codex'];
}
