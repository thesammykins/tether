/**
 * Tests for /cord sessions slash command utilities
 *
 * Tests the formatAge helper and session listing integration
 * used by the /cord sessions subcommand in bot.ts.
 */

import { describe, it, expect } from 'bun:test';
import { formatAge, listSessions, sanitizePath } from '../../src/features/sessions.js';

describe('/cord sessions command', () => {
  describe('formatAge', () => {
    it('should format seconds', () => {
      const now = new Date();
      const thirtySecondsAgo = new Date(now.getTime() - 30_000);
      expect(formatAge(thirtySecondsAgo)).toBe('30s');
    });

    it('should format minutes', () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
      expect(formatAge(fiveMinutesAgo)).toBe('5m');
    });

    it('should format hours', () => {
      const now = new Date();
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60_000);
      expect(formatAge(threeHoursAgo)).toBe('3h');
    });

    it('should format days', () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
      expect(formatAge(twoDaysAgo)).toBe('2d');
    });

    it('should format weeks', () => {
      const now = new Date();
      const threeWeeksAgo = new Date(now.getTime() - 21 * 24 * 60 * 60_000);
      expect(formatAge(threeWeeksAgo)).toBe('3w');
    });

    it('should handle 0 seconds ago', () => {
      expect(formatAge(new Date())).toBe('0s');
    });

    it('should handle edge case at 59 seconds', () => {
      const now = new Date();
      const fiftyNineSecondsAgo = new Date(now.getTime() - 59_000);
      expect(formatAge(fiftyNineSecondsAgo)).toBe('59s');
    });

    it('should handle edge case at 60 seconds', () => {
      const now = new Date();
      const sixtySecondsAgo = new Date(now.getTime() - 60_000);
      expect(formatAge(sixtySecondsAgo)).toBe('1m');
    });

    it('should handle edge case at 23 hours', () => {
      const now = new Date();
      const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60_000);
      expect(formatAge(twentyThreeHoursAgo)).toBe('23h');
    });

    it('should handle edge case at 6 days', () => {
      const now = new Date();
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60_000);
      expect(formatAge(sixDaysAgo)).toBe('6d');
    });
  });

  describe('session listing integration', () => {
    it('should return empty array for nonexistent directory', () => {
      const sessions = listSessions('/nonexistent/path/that/does/not/exist');
      expect(sessions).toEqual([]);
    });

    it('should sanitize paths consistently for lookup', () => {
      // Verify the path used by listSessions matches Claude's storage
      expect(sanitizePath('/Users/sam/project')).toBe('-Users-sam-project');
      expect(sanitizePath('C:\\Github\\project')).toBe('C--Github-project');
    });

    it('should respect limit parameter', () => {
      // Even with no sessions, limit should not cause errors
      const sessions = listSessions('/nonexistent/path', 1);
      expect(sessions).toEqual([]);
    });
  });
});
