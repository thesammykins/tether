/**
 * @thesammykins/tether
 *
 * Discord bot that bridges messages to AI agent sessions.
 * Supports Claude Code, OpenCode, and Codex CLI.
 *
 * Usage:
 *   bunx @thesammykins/tether start   # Start bot + worker
 *   bunx @thesammykins/tether setup   # Interactive setup
 *
 * Or programmatically:
 *   import { adapters, features } from '@thesammykins/tether'
 */

// Adapters
export { ClaudeAdapter } from './src/adapters/claude.ts';
export { OpenCodeAdapter } from './src/adapters/opencode.ts';
export { CodexAdapter } from './src/adapters/codex.ts';
export { getAdapter } from './src/adapters/registry.ts';
export type { AgentAdapter, SpawnResult } from './src/adapters/types.ts';

// Features
export { acknowledgeMessage } from './src/features/ack.ts';
export { getChannelContext } from './src/features/channel-context.ts';
export { generateThreadName } from './src/features/thread-naming.ts';
export { checkSessionLimits } from './src/features/session-limits.ts';
export { handlePauseResume, isThreadPausedExport } from './src/features/pause-resume.ts';
export { isAway, setBrb, setBack, isBrbMessage, isBackMessage } from './src/features/brb.ts';

// Infrastructure
export { claudeQueue } from './src/queue.ts';
export { db, getChannelConfigCached, setChannelConfig } from './src/db.ts';
