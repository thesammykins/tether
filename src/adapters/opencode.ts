import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    throw new Error('OpenCodeAdapter not yet implemented');
  }
}
