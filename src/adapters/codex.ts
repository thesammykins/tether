import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    throw new Error('CodexAdapter not yet implemented');
  }
}
