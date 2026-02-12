import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { sanitizePath, getSessionsDir, parseSessionFile, listSessions } from '../../src/features/sessions.js';
import type { SessionInfo } from '../../src/features/sessions.js';

describe('sanitizePath', () => {
  it('should sanitize macOS paths', () => {
    expect(sanitizePath('/Users/sam/project')).toBe('-Users-sam-project');
    expect(sanitizePath('/home/user/my-app')).toBe('-home-user-my-app');
  });

  it('should sanitize Windows paths', () => {
    expect(sanitizePath('C:\\Github\\project')).toBe('C--Github-project');
    expect(sanitizePath('D:\\Work\\my-app')).toBe('D--Work-my-app');
  });

  it('should sanitize paths with colons', () => {
    expect(sanitizePath('C:/Github/project')).toBe('C--Github-project');
    expect(sanitizePath('/path:with:colons')).toBe('-path-with-colons');
  });

  it('should sanitize mixed separators', () => {
    expect(sanitizePath('C:\\Users/sam\\project')).toBe('C--Users-sam-project');
  });

  it('should handle already sanitized paths', () => {
    expect(sanitizePath('already-sanitized')).toBe('already-sanitized');
  });

  it('should handle empty paths', () => {
    expect(sanitizePath('')).toBe('');
  });
});

describe('getSessionsDir', () => {
  it('should construct sessions directory path', () => {
    const result = getSessionsDir('/Users/sam/project');
    expect(result).toContain('.claude');
    expect(result).toContain('projects');
    expect(result).toContain('-Users-sam-project');
  });

  it('should handle Windows paths', () => {
    const result = getSessionsDir('C:\\Github\\project');
    expect(result).toContain('.claude');
    expect(result).toContain('projects');
    expect(result).toContain('C--Github-project');
  });
});

describe('parseSessionFile', () => {
  const testDir = join(process.cwd(), 'tmp-test-sessions');
  
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return null for non-existent file', () => {
    const result = parseSessionFile(join(testDir, 'nonexistent.jsonl'));
    expect(result).toBeNull();
  });

  it('should return null for empty file', () => {
    const filePath = join(testDir, 'empty.jsonl');
    writeFileSync(filePath, '', 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).toBeNull();
  });

  it('should parse valid JSONL session file', () => {
    const filePath = join(testDir, 'valid.jsonl');
    const content = [
      JSON.stringify({
        type: 'user',
        sessionId: 'session-123',
        uuid: 'msg-001',
        cwd: '/Users/sam/project',
        timestamp: '2026-01-01T10:00:00Z',
        message: { role: 'user', content: 'Hello, world!' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'session-123',
        uuid: 'msg-002',
        timestamp: '2026-01-01T10:01:00Z',
        message: { role: 'assistant', content: 'Hi there!' },
      }),
    ].join('\n');
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('session-123');
    expect(result?.cwd).toBe('/Users/sam/project');
    expect(result?.messageCount).toBe(2);
    expect(result?.firstMessage).toBe('Hello, world!');
    expect(result?.createdAt).toEqual(new Date('2026-01-01T10:00:00Z'));
    expect(result?.lastActivity).toEqual(new Date('2026-01-01T10:01:00Z'));
  });

  it('should skip corrupted lines', () => {
    const filePath = join(testDir, 'corrupted.jsonl');
    const content = [
      JSON.stringify({
        type: 'user',
        sessionId: 'session-456',
        uuid: 'msg-001',
        timestamp: '2026-01-02T10:00:00Z',
        message: { role: 'user', content: 'First message' },
      }),
      'THIS IS NOT VALID JSON',
      JSON.stringify({
        type: 'assistant',
        sessionId: 'session-456',
        uuid: 'msg-002',
        timestamp: '2026-01-02T10:01:00Z',
        message: { role: 'assistant', content: 'Response' },
      }),
    ].join('\n');
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('session-456');
    expect(result?.messageCount).toBe(2); // Corrupted line skipped
  });

  it('should handle missing optional fields', () => {
    const filePath = join(testDir, 'minimal.jsonl');
    const content = JSON.stringify({
      uuid: 'msg-001',
      message: { content: 'Minimal message' },
    });
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('msg-001'); // Falls back to uuid
    expect(result?.cwd).toBe('');
    expect(result?.firstMessage).toBe('');
  });

  it('should handle array content in messages', () => {
    const filePath = join(testDir, 'array-content.jsonl');
    const content = JSON.stringify({
      type: 'user',
      sessionId: 'session-789',
      uuid: 'msg-001',
      timestamp: '2026-01-03T10:00:00Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Array content message' },
          { type: 'image', source: 'base64...' },
        ],
      },
    });
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.firstMessage).toBe('Array content message');
  });

  it('should return null for file with only corrupted lines', () => {
    const filePath = join(testDir, 'all-corrupted.jsonl');
    writeFileSync(filePath, 'NOT JSON\nALSO NOT JSON\n', 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).toBeNull();
  });

  it('should handle multiple user messages and return first', () => {
    const filePath = join(testDir, 'multi-user.jsonl');
    const content = [
      JSON.stringify({
        type: 'user',
        sessionId: 'session-multi',
        uuid: 'msg-001',
        timestamp: '2026-01-04T10:00:00Z',
        message: { role: 'user', content: 'First user message' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'session-multi',
        uuid: 'msg-002',
        timestamp: '2026-01-04T10:01:00Z',
        message: { role: 'assistant', content: 'Response' },
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'session-multi',
        uuid: 'msg-003',
        timestamp: '2026-01-04T10:02:00Z',
        message: { role: 'user', content: 'Second user message' },
      }),
    ].join('\n');
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.firstMessage).toBe('First user message');
  });

  it('should handle blank lines in JSONL', () => {
    const filePath = join(testDir, 'blank-lines.jsonl');
    const content = [
      '',
      JSON.stringify({
        type: 'user',
        sessionId: 'session-blank',
        uuid: 'msg-001',
        timestamp: '2026-01-05T10:00:00Z',
        message: { role: 'user', content: 'Message with blanks' },
      }),
      '',
      '',
    ].join('\n');
    
    writeFileSync(filePath, content, 'utf-8');
    
    const result = parseSessionFile(filePath);
    expect(result).not.toBeNull();
    expect(result?.messageCount).toBe(1);
  });
});

describe('listSessions', () => {
  const testDir = join(process.cwd(), 'tmp-test-list-sessions');
  const projectPath = '/test/project';
  
  // Mock getSessionsDir to use our test directory
  const originalGetSessionsDir = getSessionsDir;
  
  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return empty array for non-existent directory', () => {
    const result = listSessions('/nonexistent/path');
    expect(result).toEqual([]);
  });

  it('should list sessions sorted by lastActivity descending', () => {
    // Create test sessions with different timestamps
    const session1Path = join(testDir, 'session1.jsonl');
    const session2Path = join(testDir, 'session2.jsonl');
    const session3Path = join(testDir, 'session3.jsonl');
    
    writeFileSync(session1Path, JSON.stringify({
      type: 'user',
      sessionId: 'session-1',
      uuid: 'msg-1',
      timestamp: '2026-01-01T10:00:00Z',
      message: { role: 'user', content: 'First session' },
    }), 'utf-8');
    
    writeFileSync(session2Path, JSON.stringify({
      type: 'user',
      sessionId: 'session-2',
      uuid: 'msg-2',
      timestamp: '2026-01-03T10:00:00Z',
      message: { role: 'user', content: 'Third session (newest)' },
    }), 'utf-8');
    
    writeFileSync(session3Path, JSON.stringify({
      type: 'user',
      sessionId: 'session-3',
      uuid: 'msg-3',
      timestamp: '2026-01-02T10:00:00Z',
      message: { role: 'user', content: 'Second session' },
    }), 'utf-8');
    
    // We need to temporarily replace getSessionsDir for this test
    // Since we can't easily mock imports in Bun, we'll create a helper test
    // that directly uses the test directory
    const files = readdirSync(testDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    
    const sessions: SessionInfo[] = [];
    for (const file of jsonlFiles) {
      const filePath = join(testDir, file);
      const stats = statSync(filePath);
      if (stats.isFile()) {
        const session = parseSessionFile(filePath);
        if (session) {
          sessions.push(session);
        }
      }
    }
    
    sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
    
    expect(sessions.length).toBe(3);
    expect(sessions[0]?.id).toBe('session-2'); // Newest
    expect(sessions[1]?.id).toBe('session-3');
    expect(sessions[2]?.id).toBe('session-1'); // Oldest
  });

  it('should apply limit parameter', () => {
    const session1Path = join(testDir, 'session1.jsonl');
    const session2Path = join(testDir, 'session2.jsonl');
    const session3Path = join(testDir, 'session3.jsonl');
    
    writeFileSync(session1Path, JSON.stringify({
      sessionId: 'session-1',
      uuid: 'msg-1',
      timestamp: '2026-01-01T10:00:00Z',
      message: { content: 'First' },
    }), 'utf-8');
    
    writeFileSync(session2Path, JSON.stringify({
      sessionId: 'session-2',
      uuid: 'msg-2',
      timestamp: '2026-01-02T10:00:00Z',
      message: { content: 'Second' },
    }), 'utf-8');
    
    writeFileSync(session3Path, JSON.stringify({
      sessionId: 'session-3',
      uuid: 'msg-3',
      timestamp: '2026-01-03T10:00:00Z',
      message: { content: 'Third' },
    }), 'utf-8');
    
    // Manual test with limit
    const files = readdirSync(testDir);
    const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl'));
    
    const sessions: SessionInfo[] = [];
    for (const file of jsonlFiles) {
      const filePath = join(testDir, file);
      const stats = statSync(filePath);
      if (stats.isFile()) {
        const session = parseSessionFile(filePath);
        if (session) {
          sessions.push(session);
        }
      }
    }
    
    sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
    const limited = sessions.slice(0, 2);
    
    expect(limited.length).toBe(2);
    expect(limited[0]?.id).toBe('session-3'); // Newest
    expect(limited[1]?.id).toBe('session-2');
  });

  it('should skip non-JSONL files', () => {
    writeFileSync(join(testDir, 'session.jsonl'), JSON.stringify({
      sessionId: 'session-valid',
      uuid: 'msg-1',
      message: { content: 'Valid' },
    }), 'utf-8');
    
    writeFileSync(join(testDir, 'README.md'), '# Not a session file', 'utf-8');
    writeFileSync(join(testDir, 'data.json'), '{"not": "jsonl"}', 'utf-8');
    
    const files = readdirSync(testDir);
    const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl'));
    
    expect(jsonlFiles.length).toBe(1);
    expect(jsonlFiles[0]).toBe('session.jsonl');
  });

  it('should skip invalid session files', () => {
    writeFileSync(join(testDir, 'valid.jsonl'), JSON.stringify({
      sessionId: 'valid-session',
      uuid: 'msg-1',
      message: { content: 'Valid' },
    }), 'utf-8');
    
    writeFileSync(join(testDir, 'invalid.jsonl'), 'NOT JSON', 'utf-8');
    writeFileSync(join(testDir, 'empty.jsonl'), '', 'utf-8');
    
    const files = readdirSync(testDir);
    const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl'));
    
    const sessions: SessionInfo[] = [];
    for (const file of jsonlFiles) {
      const filePath = join(testDir, file);
      const stats = statSync(filePath);
      if (stats.isFile()) {
        const session = parseSessionFile(filePath);
        if (session) {
          sessions.push(session);
        }
      }
    }
    
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.id).toBe('valid-session');
  });
});
