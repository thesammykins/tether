import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

/**
 * Codex CLI Adapter
 * 
 * Wraps the Codex CLI with session handling and JSON output parsing.
 * 
 * Key commands:
 * - `codex exec "<prompt>"`: Execute a new prompt
 * - `codex exec resume <sessionId> "<prompt>"`: Resume existing session
 * - `--json`: Structured output
 */

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, sessionId, resume, workingDir } = options;

    const args = ['codex', 'exec'];

    // Session handling
    if (resume) {
      // Resume existing session
      args.push('resume', sessionId);
    }

    // JSON output format
    args.push('--json');

    // The prompt (always last)
    args.push(prompt);

    // Spawn the process
    const proc = Bun.spawn(args, {
      cwd: workingDir || process.cwd(),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Collect output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // Wait for process to exit
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Codex CLI failed (exit ${exitCode}): ${stderr || 'Unknown error'}`);
    }

    // Parse JSON output
    let output = stdout.trim();
    let finalSessionId = sessionId;

    try {
      const parsed = JSON.parse(stdout);
      output = parsed.output || parsed.response || parsed.result || stdout.trim();
      
      // Extract session ID from output (Codex auto-assigns)
      if (parsed.sessionId) {
        finalSessionId = parsed.sessionId;
      } else if (parsed.session_id) {
        finalSessionId = parsed.session_id;
      }
    } catch {
      // Not JSON, use raw output
      output = stdout.trim();
    }

    return {
      output,
      sessionId: finalSessionId,
    };
  }
}
