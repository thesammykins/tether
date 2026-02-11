import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

/**
 * OpenCode CLI Adapter
 * 
 * Wraps the OpenCode CLI with session handling and JSON output parsing.
 * 
 * Key flags:
 * - `run "<prompt>"`: Execute a prompt
 * - `--session <id>` or `--continue`: Resume existing session
 * - `--format json`: Structured output
 * - `--cwd <path>`: Set working directory
 */

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, sessionId, resume, workingDir } = options;

    const args = ['opencode', 'run'];

    // Format as JSON for structured output
    args.push('--format', 'json');

    // Session handling
    if (resume) {
      // Resume existing session
      args.push('--session', sessionId);
    }

    // Working directory
    if (workingDir) {
      args.push('--cwd', workingDir);
    }

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
      throw new Error(`OpenCode CLI failed (exit ${exitCode}): ${stderr || 'Unknown error'}`);
    }

    // Parse JSON output
    let output = stdout.trim();
    let finalSessionId = sessionId;

    try {
      const parsed = JSON.parse(stdout);
      output = parsed.output || parsed.response || parsed.result || stdout.trim();
      
      // Extract session ID from output if not resuming
      if (!resume && parsed.sessionId) {
        finalSessionId = parsed.sessionId;
      } else if (!resume && parsed.session_id) {
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
