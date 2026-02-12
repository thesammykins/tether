import { existsSync, readFileSync, statSync } from 'fs';

export type BinaryResolutionSource = 'env' | 'path' | 'candidate' | 'npm' | 'npx' | 'unknown';

export interface SpawnDiagnosticsInput {
  adapterName: string;
  binaryPath: string;
  binarySource: BinaryResolutionSource;
  envVar: string;
  workingDir?: string;
  error: unknown;
  args?: string[];
}

const EXECUTABLE_MASK = 0o111;
const KNOWN_ERROR_CODES = ['ENOENT', 'EACCES', 'ENOEXEC', 'ENOTDIR', 'EPERM'] as const;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
  }

  const message = getErrorMessage(error);
  return KNOWN_ERROR_CODES.find((code) => message.includes(code));
}

function isExecutable(path: string): boolean {
  if (process.platform === 'win32') return true;
  try {
    const stat = statSync(path);
    return (stat.mode & EXECUTABLE_MASK) !== 0;
  } catch {
    return false;
  }
}

function readShebang(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf-8');
    const line = content.split('\n')[0];
    if (line?.startsWith('#!')) return line.slice(2).trim();
  } catch {
    return null;
  }
  return null;
}

function formatHints(input: SpawnDiagnosticsInput, code: string | undefined): string[] {
  const hints: string[] = [];
  const binaryExists = input.binarySource !== 'npx' && existsSync(input.binaryPath);

  if (code === 'ENOENT') {
    if (!binaryExists) {
      hints.push('Binary not found at the resolved path.');
    } else if (!isExecutable(input.binaryPath)) {
      hints.push('Binary exists but is not executable (chmod +x).');
    } else {
      const shebang = readShebang(input.binaryPath);
      if (shebang) {
        hints.push(`Shebang: ${shebang}`);
        if (shebang.startsWith('/usr/bin/env ')) {
          const envTarget = shebang.replace('/usr/bin/env', '').trim().split(/\s+/)[0];
          if (envTarget) {
            hints.push(`Ensure ${envTarget} is on PATH for the worker process.`);
          }
        } else if (shebang.startsWith('/')) {
          const interpreter = shebang.split(/\s+/)[0];
          if (interpreter && !existsSync(interpreter)) {
            hints.push(`Interpreter not found: ${interpreter}`);
          }
        }
      }
    }
  }

  if (code === 'EACCES' || code === 'EPERM') {
    hints.push('Permission denied. Verify execute permissions on the binary.');
  }

  if (code === 'ENOTDIR') {
    hints.push('Working directory is not a directory.');
  }

  if (input.binarySource === 'path') {
    hints.push('Binary was resolved from PATH; ensure PATH is set for the worker process.');
  }

  hints.push(`Set ${input.envVar} to the correct path (env or "tether config set"), then restart the worker.`);

  return hints;
}

export function formatSpawnError(input: SpawnDiagnosticsInput): Error {
  const code = getErrorCode(input.error);
  const cause = getErrorMessage(input.error);
  const lines: string[] = [];

  lines.push(`${input.adapterName} CLI failed to start${code ? ` (${code})` : ''}.`);
  lines.push(`binary: ${input.binaryPath} (source: ${input.binarySource})`);
  if (input.args?.length) {
    lines.push(`cmd: ${input.args.join(' ')}`);
  }

  if (input.workingDir) {
    const exists = existsSync(input.workingDir);
    lines.push(`cwd: ${input.workingDir}${exists ? '' : ' (missing)'}`);
  }

  if (cause) {
    lines.push(`cause: ${cause}`);
  }

  const hints = formatHints(input, code);
  if (hints.length > 0) {
    lines.push('hints:');
    for (const hint of hints) {
      lines.push(`- ${hint}`);
    }
  }

  return new Error(lines.join('\n'));
}
