export interface SpawnOptions {
  prompt: string;
  sessionId: string;
  resume: boolean;
  systemPrompt?: string;
  workingDir?: string;
}

export interface SpawnResult {
  output: string;
  sessionId: string;
}

export interface AgentAdapter {
  readonly name: string;
  spawn(options: SpawnOptions): Promise<SpawnResult>;
}
