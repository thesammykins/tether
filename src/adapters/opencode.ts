import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';
import type { BinarySource } from './resolve-binary.js';
import { getHomeCandidate, getSystemBinaryCandidates, resolveBinary, resolveNpmGlobalBinary, normalizeBinarySource } from './resolve-binary.js';
import { formatSpawnError } from './spawn-diagnostics.js';
import { debugLog, debugBlock } from '../debug.js';

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

// Cache resolved binary path
let cachedBinaryPath: string | null = null;
let cachedBinarySource: BinarySource | 'unknown' = 'unknown';

export class OpenCodeAdapter implements AgentAdapter {
  readonly name = 'opencode';

  private binarySource: BinarySource | 'unknown' = 'unknown';

  private async getBinaryPath(): Promise<string> {
    const envValue = process.env.OPENCODE_BIN;
    if (envValue) {
      if (cachedBinaryPath !== envValue) {
        cachedBinaryPath = envValue;
        cachedBinarySource = 'env';
        console.log(`[opencode] Binary resolved (env): ${envValue}`);
      }
      this.binarySource = cachedBinarySource;
      debugBlock('opencode', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: process.env.OPENCODE_BIN || 'none',
      });
      return cachedBinaryPath;
    }

    if (cachedBinaryPath) {
      this.binarySource = cachedBinarySource;
      debugBlock('opencode', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
      return cachedBinaryPath;
    }

    const resolved = await resolveBinary({
      name: 'opencode',
      candidates: [
        ...getSystemBinaryCandidates('opencode'),
        getHomeCandidate('.opencode', 'bin', 'opencode'),
      ],
      windowsCandidates: [getHomeCandidate('.opencode', 'bin', 'opencode.exe')],
    });

    if (resolved) {
      cachedBinaryPath = resolved.path;
      cachedBinarySource = normalizeBinarySource(resolved.source);
      this.binarySource = cachedBinarySource;
      console.log(`[opencode] Binary resolved (${resolved.source}): ${resolved.path}`);
      debugBlock('opencode', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
      return cachedBinaryPath;
    }

    const npmBinary = await resolveNpmGlobalBinary('opencode');
    if (npmBinary) {
      cachedBinaryPath = npmBinary;
      cachedBinarySource = 'npm';
      this.binarySource = cachedBinarySource;
      console.log(`[opencode] Binary resolved (npm): ${npmBinary}`);
      debugBlock('opencode', 'Binary Resolution', {
        source: cachedBinarySource,
        path: cachedBinaryPath,
        envOverride: 'none',
      });
      return cachedBinaryPath;
    }

    throw new Error(
      'OpenCode CLI not found. Install it or set OPENCODE_BIN to the binary path.'
    );
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, sessionId, resume, workingDir } = options;

    const binaryPath = await this.getBinaryPath();
    const args = [binaryPath, 'run'];

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
    const cwd = workingDir || process.cwd();

    debugBlock('opencode', 'Spawn', {
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
        adapterName: 'OpenCode',
        binaryPath,
        binarySource: this.binarySource,
        envVar: 'OPENCODE_BIN',
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
        adapterName: 'OpenCode',
        binaryPath,
        binarySource: this.binarySource,
        envVar: 'OPENCODE_BIN',
        workingDir: cwd,
        args,
        error,
      });
    }

    debugLog('opencode', `Exit code: ${exitCode}`);

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
