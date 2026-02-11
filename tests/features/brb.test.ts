/**
 * Tests for brb.ts (BRB state management)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  setBrb,
  setBack,
  isAway,
  getAwayThreads,
  isBrbMessage,
  isBackMessage,
} from '../../src/features/brb';

describe('brb state management', () => {
  beforeEach(() => {
    // Clear all away threads before each test
    const threads = getAwayThreads();
    threads.forEach((threadId) => setBack(threadId));
  });

  test('setBrb marks thread as away', () => {
    const threadId = 'thread-1';
    setBrb(threadId);
    expect(isAway(threadId)).toBe(true);
  });

  test('setBack marks thread as not away', () => {
    const threadId = 'thread-2';
    setBrb(threadId);
    expect(isAway(threadId)).toBe(true);
    
    setBack(threadId);
    expect(isAway(threadId)).toBe(false);
  });

  test('isAway returns false for thread that was never marked away', () => {
    expect(isAway('thread-never-away')).toBe(false);
  });

  test('getAwayThreads returns all away threads', () => {
    setBrb('thread-a');
    setBrb('thread-b');
    setBrb('thread-c');
    
    const awayThreads = getAwayThreads();
    expect(awayThreads).toContain('thread-a');
    expect(awayThreads).toContain('thread-b');
    expect(awayThreads).toContain('thread-c');
    expect(awayThreads.length).toBe(3);
  });

  test('getAwayThreads returns empty array when no threads away', () => {
    const awayThreads = getAwayThreads();
    expect(awayThreads).toEqual([]);
  });

  test('setting same thread to brb multiple times is idempotent', () => {
    const threadId = 'thread-3';
    setBrb(threadId);
    setBrb(threadId);
    setBrb(threadId);
    
    const awayThreads = getAwayThreads();
    expect(awayThreads.length).toBe(1);
    expect(isAway(threadId)).toBe(true);
  });

  test('setting back a thread that is not away is safe', () => {
    const threadId = 'thread-4';
    expect(isAway(threadId)).toBe(false);
    
    setBack(threadId); // Should not throw
    expect(isAway(threadId)).toBe(false);
  });
});

describe('isBrbMessage', () => {
  test('recognizes "brb"', () => {
    expect(isBrbMessage('brb')).toBe(true);
  });

  test('recognizes "be right back"', () => {
    expect(isBrbMessage('be right back')).toBe(true);
  });

  test('recognizes "afk"', () => {
    expect(isBrbMessage('afk')).toBe(true);
  });

  test('recognizes "stepping away"', () => {
    expect(isBrbMessage('stepping away')).toBe(true);
  });

  test('is case insensitive', () => {
    expect(isBrbMessage('BRB')).toBe(true);
    expect(isBrbMessage('BRb')).toBe(true);
    expect(isBrbMessage('BE RIGHT BACK')).toBe(true);
    expect(isBrbMessage('AFK')).toBe(true);
    expect(isBrbMessage('STEPPING AWAY')).toBe(true);
  });

  test('handles whitespace', () => {
    expect(isBrbMessage('  brb  ')).toBe(true);
    expect(isBrbMessage('\tafk\n')).toBe(true);
    expect(isBrbMessage('  be right back  ')).toBe(true);
  });

  test('does not match partial words', () => {
    expect(isBrbMessage('comeback')).toBe(false);
    expect(isBrbMessage('brbq')).toBe(false);
    expect(isBrbMessage('afkay')).toBe(false);
    expect(isBrbMessage('not stepping away here')).toBe(false);
  });

  test('does not match empty string', () => {
    expect(isBrbMessage('')).toBe(false);
  });

  test('does not match unrelated messages', () => {
    expect(isBrbMessage('hello')).toBe(false);
    expect(isBrbMessage('going to lunch')).toBe(false);
    expect(isBrbMessage('see you later')).toBe(false);
  });
});

describe('isBackMessage', () => {
  test('recognizes "back"', () => {
    expect(isBackMessage('back')).toBe(true);
  });

  test('recognizes "im back"', () => {
    expect(isBackMessage('im back')).toBe(true);
  });

  test('recognizes "i\'m back"', () => {
    expect(isBackMessage("i'm back")).toBe(true);
  });

  test('recognizes "here"', () => {
    expect(isBackMessage('here')).toBe(true);
  });

  test('is case insensitive', () => {
    expect(isBackMessage('BACK')).toBe(true);
    expect(isBackMessage('Back')).toBe(true);
    expect(isBackMessage('IM BACK')).toBe(true);
    expect(isBackMessage('HERE')).toBe(true);
  });

  test('handles whitespace', () => {
    expect(isBackMessage('  back  ')).toBe(true);
    expect(isBackMessage('\there\n')).toBe(true);
    expect(isBackMessage('  im back  ')).toBe(true);
  });

  test('does not match partial words', () => {
    expect(isBackMessage('comeback')).toBe(false);
    expect(isBackMessage('backpack')).toBe(false);
    expect(isBackMessage('hear')).toBe(false);
    expect(isBackMessage('where')).toBe(false);
  });

  test('does not match empty string', () => {
    expect(isBackMessage('')).toBe(false);
  });

  test('does not match unrelated messages', () => {
    expect(isBackMessage('hello')).toBe(false);
    expect(isBackMessage('what is this')).toBe(false);
    expect(isBackMessage('backing up')).toBe(false);
  });
});
