import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    throw new Error('ClaudeAdapter not yet implemented');
  }
}
