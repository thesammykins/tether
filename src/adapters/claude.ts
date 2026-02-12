import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';
import { getHomeCandidate, getSystemBinaryCandidates, resolveBinary, resolveNpmGlobalBinary } from './resolve-binary.js';

/**
 * Claude CLI Adapter
 * 
 * Wraps the Claude Code CLI with proper session handling and output parsing.
 * 
 * Key flags:
 * - `--print`: Non-interactive mode, returns output
 * - `--session-id UUID`: Set session ID for new sessions
 * - `--resume UUID`: Resume an existing session (for follow-ups)
 * - `--continue` / `-c`: Resume latest session in directory (fallback)
 * - `--append-system-prompt`: Inject context that survives compaction
 * - `-p "prompt"`: The actual prompt to send
 * - `--output-format json`: Structured output (if supported)
 * 
 * Known Issues:
 * - GitHub Issue #5012: `--resume` was broken in v1.0.67
 * - Sessions are directory-scoped; must resume from same cwd
 * - `--continue` is preferred fallback when `--resume` fails
 */

const TIMEZONE = process.env.TZ || 'UTC';
const KNOWN_BUGGY_VERSIONS = ['1.0.67'];

// Cache resolved binary path
let cachedBinaryPath: string | null = null;

/**
 * Resolve the Claude CLI binary path.
 * Tries `which claude` (macOS/Linux) or `where.exe claude` (Windows),
 * then falls back to checking `npx @anthropic-ai/claude-code` availability.
 */
async function getClaudeBinaryPath(): Promise<string> {
  const envValue = process.env.CLAUDE_BIN;
  if (envValue) {
    if (cachedBinaryPath !== envValue) {
      cachedBinaryPath = envValue;
      console.log(`[claude] Binary resolved (env): ${envValue}`);
    }
    return cachedBinaryPath;
  }

  if (cachedBinaryPath) {
    return cachedBinaryPath;
  }

  const resolved = await resolveBinary({
    name: 'claude',
    candidates: [
      ...getSystemBinaryCandidates('claude'),
      getHomeCandidate('.claude', 'bin', 'claude'),
      getHomeCandidate('.local', 'bin', 'claude'),
    ],
    windowsCandidates: [
      getHomeCandidate('.claude', 'bin', 'claude.exe'),
      getHomeCandidate('.local', 'bin', 'claude.exe'),
    ],
  });

  if (resolved) {
    cachedBinaryPath = resolved.path;
    console.log(`[claude] Binary resolved (${resolved.source}): ${resolved.path}`);
    return cachedBinaryPath;
  }

  const npmBinary = await resolveNpmGlobalBinary('claude');
  if (npmBinary) {
    cachedBinaryPath = npmBinary;
    console.log(`[claude] Binary resolved (npm): ${npmBinary}`);
    return cachedBinaryPath;
  }

  // Try npx fallback
  try {
    const proc = Bun.spawn(['npx', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;

    if (exitCode === 0) {
      cachedBinaryPath = 'npx';
      console.log('[claude] Binary not in PATH, will use: npx @anthropic-ai/claude-code');
      return cachedBinaryPath;
    }
  } catch {
    // Fall through to error
  }

  throw new Error(
    'Claude CLI not found. Install it or set CLAUDE_BIN to the binary path.'
  );
}

/**
 * Get the Claude CLI version.
 * Runs `claude --version` and parses the output.
 */
async function getClaudeVersion(binaryPath: string): Promise<string> {
  const args = binaryPath === 'npx'
    ? ['npx', '@anthropic-ai/claude-code', '--version']
    : [binaryPath, '--version'];

  try {
    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const version = stdout.trim();
      console.log(`[claude] CLI version: ${version}`);

      // Warn if known buggy version
      if (KNOWN_BUGGY_VERSIONS.some((v) => version.includes(v))) {
        console.warn(
          `[claude] WARNING: Version ${version} has known issues with --resume (GitHub #5012)`
        );
      }

      return version;
    }
  } catch (err) {
    console.warn('[claude] Could not determine CLI version:', err);
  }

  return 'unknown';
}

function getDatetimeContext(): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TIMEZONE,
  });
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude';

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, sessionId, resume, systemPrompt, workingDir } = options;

    const cwd = workingDir || process.env.CLAUDE_WORKING_DIR || process.cwd();

    // Resolve binary path and get version
    const binaryPath = await getClaudeBinaryPath();
    await getClaudeVersion(binaryPath);

    // Build CLI arguments
    const args = this.buildArgs(binaryPath, options);

    console.log('[claude] Spawning with args:', args);
    console.log('[claude] Working directory:', cwd);

    // Spawn the process
    const result = await this.spawnProcess(args, cwd, sessionId, resume);

    return result;
  }

  /**
   * Build CLI arguments based on options.
   */
  private buildArgs(binaryPath: string, options: SpawnOptions): string[] {
    const { prompt, sessionId, resume, systemPrompt } = options;

    const args: string[] = [];

    if (binaryPath === 'npx') {
      args.push('npx', '@anthropic-ai/claude-code');
    } else {
      args.push(binaryPath);
    }

    // Non-interactive mode
    args.push('--print');

    // Output format
    args.push('--output-format', 'json');

    // Session handling
    if (resume) {
      // Resume existing session for follow-up messages
      args.push('--resume', sessionId);
    } else {
      // New session - set the ID upfront
      args.push('--session-id', sessionId);
    }

    // Inject datetime context (survives session compaction)
    const datetimeContext = `Current date/time: ${getDatetimeContext()}`;
    const fullSystemPrompt = systemPrompt
      ? `${datetimeContext}\n\n${systemPrompt}`
      : datetimeContext;

    args.push('--append-system-prompt', fullSystemPrompt);

    // The actual prompt
    args.push('-p', prompt);

    return args;
  }

  /**
   * Spawn the Claude process and handle fallback for resume failures.
   */
  private async spawnProcess(
    args: string[],
    cwd: string,
    sessionId: string,
    resume: boolean
  ): Promise<SpawnResult> {
    let proc = Bun.spawn(args, {
      cwd,
      env: {
        ...process.env,
        TZ: TIMEZONE,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Collect output
    let stdout = await new Response(proc.stdout).text();
    let stderr = await new Response(proc.stderr).text();

    // Wait for process to exit
    let exitCode = await proc.exited;

    console.log('[claude] Exit code:', exitCode);
    if (stderr) {
      console.log('[claude] Stderr:', stderr);
    }

    // Handle --resume fallback
    if (
      resume &&
      exitCode !== 0 &&
      (stderr.includes('No conversation found') || stderr.includes('Session not found'))
    ) {
      console.log(
        `[claude] --resume failed for ${sessionId}, falling back to --continue`
      );

      // Rebuild args with --continue instead of --resume
      const continueArgs = args.map((arg, i) => {
        if (arg === '--resume') {
          return '--continue';
        }
        // Skip the session ID that follows --resume
        if (i > 0 && args[i - 1] === '--resume') {
          return null;
        }
        return arg;
      }).filter((arg): arg is string => arg !== null);

      console.log('[claude] Retrying with args:', continueArgs);

      // Retry with --continue
      proc = Bun.spawn(continueArgs, {
        cwd,
        env: {
          ...process.env,
          TZ: TIMEZONE,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      stdout = await new Response(proc.stdout).text();
      stderr = await new Response(proc.stderr).text();
      exitCode = await proc.exited;

      console.log('[claude] Fallback exit code:', exitCode);
      if (stderr) {
        console.log('[claude] Fallback stderr:', stderr);
      }
    }

    if (exitCode !== 0) {
      throw new Error(`Claude CLI failed (exit ${exitCode}): ${stderr || 'Unknown error'}`);
    }

    // Parse JSON output or fall back to raw text
    let output = stdout.trim();
    try {
      const parsed = JSON.parse(stdout);
      output = parsed.response || parsed.output || stdout.trim();
    } catch {
      // Not JSON, use raw output
      output = stdout.trim();
    }

    return {
      output,
      sessionId,
    };
  }
}
