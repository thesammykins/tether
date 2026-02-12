import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';
import type { BinarySource } from './resolve-binary.js';
import { getHomeCandidate, getSystemBinaryCandidates, resolveBinary, resolveNpmGlobalBinary, normalizeBinarySource } from './resolve-binary.js';
import { formatSpawnError } from './spawn-diagnostics.js';
import { debugLog, debugBlock } from '../debug.js';

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
let cachedBinarySource: BinarySource | 'unknown' = 'unknown';

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex';

  private binarySource: BinarySource | 'unknown' = 'unknown';

  private async getBinaryPath(): Promise<string> {
    const envValue = process.env.CODEX_BIN;
    if (envValue) {
      if (cachedBinaryPath !== envValue) {
        cachedBinaryPath = envValue;
        cachedBinarySource = 'env';
        console.log(`[codex] Binary resolved (env): ${envValue}`);
      }
      this.binarySource = cachedBinarySource;
      debugBlock('codex', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: process.env.CODEX_BIN || 'none',
      });
      return cachedBinaryPath;
    }

    if (cachedBinaryPath) {
      this.binarySource = cachedBinarySource;
      debugBlock('codex', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
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
      cachedBinarySource = normalizeBinarySource(resolved.source);
      this.binarySource = cachedBinarySource;
      console.log(`[codex] Binary resolved (${resolved.source}): ${resolved.path}`);
      debugBlock('codex', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
      return cachedBinaryPath;
    }

    const npmBinary = await resolveNpmGlobalBinary('codex');
    if (npmBinary) {
      cachedBinaryPath = npmBinary;
      cachedBinarySource = 'npm';
      this.binarySource = cachedBinarySource;
      console.log(`[codex] Binary resolved (npm): ${npmBinary}`);
      debugBlock('codex', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
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
    const cwd = workingDir || process.cwd();

    debugBlock('codex', 'Spawn', {
      binary: binaryPath,
      args: args.join(' '),
      cwd,
      resume: String(resume),
    });

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        cwd,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (error) {
      throw formatSpawnError({
        adapterName: 'Codex',
        binaryPath,
        binarySource: this.binarySource,
        envVar: 'CODEX_BIN',
        workingDir: cwd,
        args,
        error,
      });
    }

    // Collect output and handle async spawn failures
    let stdout: string;
    let stderr: string;
    let exitCode: number;
    try {
      stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
      stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();
      exitCode = await proc.exited;
    } catch (error) {
      throw formatSpawnError({
        adapterName: 'Codex',
        binaryPath,
        binarySource: this.binarySource,
        envVar: 'CODEX_BIN',
        workingDir: cwd,
        args,
        error,
      });
    }

    debugLog('codex', `Exit code: ${exitCode}`);

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
