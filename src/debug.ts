/**
 * Shared debug logger utility
 * Enable with TETHER_DEBUG=true environment variable
 */

const isDebug = () => process.env.TETHER_DEBUG === 'true';

export function debugLog(prefix: string, msg: string): void {
  if (isDebug()) {
    process.stdout.write(`[${prefix}:debug] ${msg}\n`);
  }
}

export function debugBlock(prefix: string, label: string, data: Record<string, unknown>): void {
  if (!isDebug()) return;
  const lines = [`[${prefix}:debug] === ${label} ===`];
  for (const [key, value] of Object.entries(data)) {
    // Redact anything that looks like a token/secret
    const display = typeof value === 'string' && (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret'))
      ? '[REDACTED]'
      : String(value);
    lines.push(`  ${key}: ${display}`);
  }
  process.stdout.write(lines.join('\n') + '\n');
}
