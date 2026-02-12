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
 * - `run`: Execute a prompt (reads from stdin or positional args)
 * - `--session <id>` or `--continue`: Resume existing session
 * - `--format json`: NDJSON event stream output
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

/**
 * Parse NDJSON event stream from `opencode run --format json`.
 *
 * Each line is a JSON object like:
 *   {"type":"text","sessionID":"ses_xxx","part":{"text":"Hello",...}}
 *   {"type":"step_start","sessionID":"ses_xxx","part":{...}}
 *   {"type":"step_finish","sessionID":"ses_xxx","part":{...}}
 *
 * We concatenate all "text" event parts and extract the sessionID.
 */
function parseNdjsonEvents(raw: string): { text: string; eventSessionId: string | null } {
  const lines = raw.trim().split('\n').filter(Boolean);
  const textParts: string[] = [];
  let eventSessionId: string | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;

      // Extract sessionID from any event
      if (!eventSessionId && typeof event.sessionID === 'string') {
        eventSessionId = event.sessionID;
      }

      // Collect text content
      if (event.type === 'text') {
        const part = event.part as Record<string, unknown> | undefined;
        if (part && typeof part.text === 'string') {
          textParts.push(part.text);
        }
      }
    } catch {
      // Skip non-JSON lines (shouldn't happen with --format json)
    }
  }

  return { text: textParts.join(''), eventSessionId };
}

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

    // Format as JSON for structured output (NDJSON event stream)
    args.push('--format', 'json');

    // Session handling
    if (resume) {
      args.push('--session', sessionId);
    }

    // Note: opencode has no --cwd flag; working directory is set via
    // Bun.spawn's cwd option below.

    // Prompt is piped via stdin to avoid shell escaping issues with
    // multi-line prompts containing XML tags, angle brackets, etc.

    const cwd = workingDir || process.cwd();

    debugBlock('opencode', 'Spawn', {
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
        adapterName: 'OpenCode',
        binaryPath,
        binarySource: this.binarySource,
        envVar: 'OPENCODE_BIN',
        workingDir: cwd,
        args,
        error,
      });
    }

    // Write prompt to stdin then close the stream.
    // Bun.spawn with stdin:'pipe' returns a FileSink.
    const stdin = proc.stdin;
    if (!stdin || typeof stdin === 'number') {
      throw new Error('Failed to get writable stdin from OpenCode process');
    }
    try {
      stdin.write(prompt);
      stdin.end();
    } catch (error) {
      throw new Error(`Failed to write prompt to OpenCode stdin: ${error}`);
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

    // Parse NDJSON event stream from --format json output.
    // Each line is a JSON object with a "type" field. We extract:
    // - sessionID from any event (they all carry it)
    // - text content from "text" type events
    const { text, eventSessionId } = parseNdjsonEvents(stdout);
    const output = text || stdout.trim();
    const finalSessionId = eventSessionId || sessionId;

    return {
      output,
      sessionId: finalSessionId,
    };
  }
}
