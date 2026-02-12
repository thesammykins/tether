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
 * - `codex exec`: Execute a new prompt (reads from stdin)
 * - `codex exec resume <sessionId>`: Resume existing session
 * - `--json`: Structured output
 * 
 * The prompt is piped via stdin to handle multi-line content with
 * XML tags and special characters safely.
 */

// Cache resolved binary path
let cachedBinaryPath: string | null = null;
let cachedBinarySource: BinarySource | 'unknown' = 'unknown';

/** Reset cached binary path (for testing only) */
export function _resetBinaryCache(): void {
  cachedBinaryPath = null;
  cachedBinarySource = 'unknown';
}

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
      args.push('resume', sessionId);
    }

    // JSON output format
    args.push('--json');

    // Prompt is piped via stdin to avoid shell escaping issues with
    // multi-line prompts containing XML tags, angle brackets, etc.

    const cwd = workingDir || process.cwd();

    debugBlock('codex', 'Spawn', {
      binary: binaryPath,
      args: args.join(' '),
      cwd,
      resume: String(resume),
      promptLength: String(prompt.length),
    });

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        cwd,
        env: process.env,
        stdin: 'pipe',
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

    // Write prompt to stdin then close the stream.
    // Bun.spawn with stdin:'pipe' returns a FileSink.
    const stdin = proc.stdin;
    if (!stdin || typeof stdin === 'number') {
      throw new Error('Failed to get writable stdin from Codex process');
    }
    try {
      stdin.write(prompt);
      stdin.end();
    } catch (error) {
      throw new Error(`Failed to write prompt to Codex stdin: ${error}`);
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
