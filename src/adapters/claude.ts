import type { AgentAdapter, SpawnOptions, SpawnResult } from './types.js';

/**
 * Claude CLI Adapter
 * 
 * Wraps the Claude Code CLI with proper session handling and output parsing.
 * 
 * Key flags:
 * - `--print`: Non-interactive mode, returns output
 * - `--session-id UUID`: Set session ID for new sessions
 * - `--resume UUID`: Resume an existing session (for follow-ups)
 * - `--append-system-prompt`: Inject context that survives compaction
 * - `-p "prompt"`: The actual prompt to send
 * - `--output-format json`: Structured output (if supported)
 */

const TIMEZONE = process.env.TZ || 'UTC';

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

    // Build CLI arguments
    const args = ['claude'];

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

    // Spawn the process
    const proc = Bun.spawn(args, {
      cwd,
      env: {
        ...process.env,
        TZ: TIMEZONE,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Collect output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // Wait for process to exit
    const exitCode = await proc.exited;

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
