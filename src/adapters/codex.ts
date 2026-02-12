import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';
import { getHomeCandidate, getSystemBinaryCandidates, resolveBinary, resolveNpmGlobalBinary } from './resolve-binary.js';

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

// Cache resolved binary path
let cachedBinaryPath: string | null = null;

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';

  private async getBinaryPath(): Promise<string> {
    const envValue = process.env.CODEX_BIN;
    if (envValue) {
      if (cachedBinaryPath !== envValue) {
        cachedBinaryPath = envValue;
        console.log(`[codex] Binary resolved (env): ${envValue}`);
      }
      return cachedBinaryPath;
    }

    if (cachedBinaryPath) {
      return cachedBinaryPath;
    }

    const resolved = await resolveBinary({
      name: 'codex',
      candidates: [
        ...getSystemBinaryCandidates('codex'),
        getHomeCandidate('.codex', 'bin', 'codex'),
      ],
      windowsCandidates: [getHomeCandidate('.codex', 'bin', 'codex.exe')],
    });

    if (resolved) {
      cachedBinaryPath = resolved.path;
      console.log(`[codex] Binary resolved (${resolved.source}): ${resolved.path}`);
      return cachedBinaryPath;
    }

    const npmBinary = await resolveNpmGlobalBinary('codex');
    if (npmBinary) {
      cachedBinaryPath = npmBinary;
      console.log(`[codex] Binary resolved (npm): ${npmBinary}`);
      return cachedBinaryPath;
    }

    throw new Error(
      'Codex CLI not found. Install it or set CODEX_BIN to the binary path.'
    );
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, sessionId, resume, workingDir } = options;

    const binaryPath = await this.getBinaryPath();
    const args = [binaryPath, 'exec'];

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
