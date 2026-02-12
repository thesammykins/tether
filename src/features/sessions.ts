import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SessionInfo {
  id: string;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  firstMessage: string;
  cwd: string;
}

interface SessionLine {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
}

/**
 * Convert a filesystem path to Claude's sanitized directory name.
 * Claude replaces `/`, `\`, and `:` with `-`.
 * 
 * Examples:
 * - macOS: `/Users/sam/project` → `-Users-sam-project`
 * - Windows: `C:\Github\project` → `C--Github-project`
 * - Linux: `/home/user/project` → `-home-user-project`
 */
export function sanitizePath(projectPath: string): string {
  return projectPath.replace(/[/\\:]/g, '-');
}

/**
 * Return the full path to Claude's sessions directory for a given project path.
 */
export function getSessionsDir(projectPath: string): string {
  const sanitized = sanitizePath(projectPath);
  return join(homedir(), '.claude', 'projects', sanitized);
}

/**
 * Parse a JSONL session file and extract metadata.
 * Returns null if the file doesn't exist, is empty, or cannot be parsed.
 */
export function parseSessionFile(filePath: string): SessionInfo | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) {
      return null;
    }

    const lines = content.split('\n');
    const messages: SessionLine[] = [];

    // Parse each line, skipping corrupted ones
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as SessionLine;
        messages.push(parsed);
      } catch {
        // Skip corrupted lines
        continue;
      }
    }

    if (messages.length === 0) {
      return null;
    }

    // Extract metadata
    const firstMsg = messages[0];
    if (!firstMsg) {
      return null;
    }
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) {
      return null;
    }

    // Get session ID
    const sessionId = firstMsg.sessionId || firstMsg.uuid || 'unknown';

    // Get CWD (usually from first message)
    const cwd = firstMsg.cwd || '';

    // Get timestamps
    const createdAt = firstMsg.timestamp ? new Date(firstMsg.timestamp) : new Date(0);
    const lastActivity = lastMsg.timestamp ? new Date(lastMsg.timestamp) : createdAt;

    // Get first user message content
    let firstMessage = '';
    for (const msg of messages) {
      if (msg.type === 'user' && msg.message?.content) {
        const content = msg.message.content;
        if (typeof content === 'string') {
          firstMessage = content;
        } else if (Array.isArray(content)) {
          // Handle array of content blocks
          const textBlock = content.find(block => block.type === 'text' && block.text);
          if (textBlock && textBlock.text) {
            firstMessage = textBlock.text;
          }
        }
        break;
      }
    }

    return {
      id: sessionId,
      createdAt,
      lastActivity,
      messageCount: messages.length,
      firstMessage,
      cwd,
    };
  } catch {
    return null;
  }
}

/**
 * List all sessions for a project path, sorted by lastActivity descending.
 * Returns empty array if the sessions directory doesn't exist.
 */
export function listSessions(projectPath: string, limit?: number): SessionInfo[] {
  const sessionsDir = getSessionsDir(projectPath);

  if (!existsSync(sessionsDir)) {
    return [];
  }

  try {
    const files = readdirSync(sessionsDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    const sessions: SessionInfo[] = [];

    for (const file of jsonlFiles) {
      const filePath = join(sessionsDir, file);
      
      // Skip if not a file
      try {
        const stats = statSync(filePath);
        if (!stats.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      const session = parseSessionFile(filePath);
      if (session) {
        sessions.push(session);
      }
    }

    // Sort by lastActivity descending (newest first)
    sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    // Apply limit if specified
    if (limit !== undefined && limit > 0) {
      return sessions.slice(0, limit);
    }

    return sessions;
  } catch {
    return [];
  }
}

/**
 * Format a date as a human-readable relative time string.
 * e.g. "2m", "3h", "1d", "2w"
 */
export function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}
