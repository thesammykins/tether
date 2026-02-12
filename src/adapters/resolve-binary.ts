import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { debugLog, debugBlock } from '../debug.js';

export type BinarySource = 'env' | 'path' | 'candidate' | 'npm';

export function normalizeBinarySource(source?: BinarySource): BinarySource | 'unknown' {
  return source ?? 'unknown';
}

export interface ResolveBinaryOptions {
  name: string;
  candidates?: string[];
  windowsCandidates?: string[];
}

export interface ResolveBinaryResult {
  path: string;
  source: BinarySource;
}

export async function resolveBinary(
  options: ResolveBinaryOptions
): Promise<ResolveBinaryResult | null> {
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where.exe' : 'which';

  debugLog('resolve-binary', `Resolving binary: ${options.name}`);

  try {
    const proc = Bun.spawn([whichCommand, options.name], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    debugBlock('resolve-binary', `${whichCommand} result`, {
      command: `${whichCommand} ${options.name}`,
      exitCode: String(exitCode),
      stdout: stdout.trim() || '(empty)',
    });

    if (exitCode === 0 && stdout.trim()) {
      const firstPath = stdout.trim().split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        debugLog('resolve-binary', `✓ Found via ${whichCommand}: ${firstPath}`);
        return { path: firstPath, source: 'path' };
      }
      // which returned a path that doesn't exist (stale PATH entry)
      debugLog('resolve-binary', `✗ ${whichCommand} returned non-existent path: ${firstPath}`);
    }
  } catch (error) {
    debugLog('resolve-binary', `${whichCommand} failed: ${error}`);
    // Ignore and fall through to candidates
  }

  const candidates = isWindows ? options.windowsCandidates : options.candidates;
  if (candidates) {
    debugLog('resolve-binary', `Checking ${candidates.length} candidate path(s)`);
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        debugLog('resolve-binary', `✓ Found via candidate: ${candidate}`);
        return { path: candidate, source: 'candidate' };
      }
    }
    debugLog('resolve-binary', '✗ No candidates found');
  }

  debugLog('resolve-binary', `Binary not found: ${options.name}`);
  return null;
}

export function getSystemBinaryCandidates(name: string): string[] {
  return [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
}

export async function resolveNpmGlobalBinary(binaryName: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['npm', 'bin', '-g'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) return null;

    const binDir = stdout.trim().split('\n')[0];
    if (!binDir) return null;

    const candidates = [join(binDir, binaryName)];
    if (process.platform === 'win32') {
      candidates.unshift(join(binDir, `${binaryName}.cmd`));
      candidates.unshift(join(binDir, `${binaryName}.exe`));
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }

  return null;
}

export function getHomeCandidate(...parts: string[]): string {
  return join(homedir(), ...parts);
}
