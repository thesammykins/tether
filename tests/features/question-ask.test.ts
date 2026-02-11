/**
 * Tests for question-ask (Question response store)
 * 
 * Tests the in-memory question response store used by tether ask CLI command.
 * The store maps requestIds to user responses (button clicks or typed answers).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { questionResponses, pendingTypedAnswers } from '../../src/api';

describe('question response store', () => {
  beforeEach(() => {
    // Clear the stores before each test
    questionResponses.clear();
    pendingTypedAnswers.clear();
  });

  test('questionResponses starts empty', () => {
    expect(questionResponses.size).toBe(0);
  });

  test('pendingTypedAnswers starts empty', () => {
    expect(pendingTypedAnswers.size).toBe(0);
  });

  test('can store a response in questionResponses', () => {
    const requestId = 'test-request-1';
    questionResponses.set(requestId, { answer: 'Option A', optionIndex: 0 });
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)).toEqual({ answer: 'Option A', optionIndex: 0 });
  });

  test('can store null in questionResponses (unanswered)', () => {
    const requestId = 'test-request-2';
    questionResponses.set(requestId, null);
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)).toBeNull();
  });

  test('can track typed answers in pendingTypedAnswers', () => {
    const threadId = 'thread-123';
    const requestId = 'request-456';
    pendingTypedAnswers.set(threadId, requestId);
    
    expect(pendingTypedAnswers.has(threadId)).toBe(true);
    expect(pendingTypedAnswers.get(threadId)).toBe(requestId);
  });

  test('stores regular button option response', () => {
    const requestId = 'req-abc123';
    const response = { answer: 'Option A', optionIndex: 0 };
    
    questionResponses.set(requestId, response);
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)).toEqual(response);
  });

  test('stores __type__ option response', () => {
    const requestId = 'req-def456';
    const threadId = 'thread-789';
    
    // Simulate user clicking "Type answer" button
    questionResponses.set(requestId, { answer: '__type__', optionIndex: -1 });
    pendingTypedAnswers.set(threadId, requestId);
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)).toEqual({
      answer: '__type__',
      optionIndex: -1,
    });
    expect(pendingTypedAnswers.has(threadId)).toBe(true);
    expect(pendingTypedAnswers.get(threadId)).toBe(requestId);
  });

  test('handles multiple requests to different requestIds', () => {
    const req1 = 'req-001';
    const req2 = 'req-002';

    questionResponses.set(req1, { answer: 'Yes', optionIndex: 0 });
    questionResponses.set(req2, { answer: 'No', optionIndex: 1 });

    expect(questionResponses.size).toBe(2);
    expect(questionResponses.get(req1)).toEqual({ answer: 'Yes', optionIndex: 0 });
    expect(questionResponses.get(req2)).toEqual({ answer: 'No', optionIndex: 1 });
  });

  test('can check if requestId exists (for 404 logic)', () => {
    const requestId = 'req-exists';
    
    expect(questionResponses.has(requestId)).toBe(false); // 404
    
    questionResponses.set(requestId, null); // Register but unanswered
    expect(questionResponses.has(requestId)).toBe(true); // Not 404
    
    questionResponses.set(requestId, { answer: 'Done', optionIndex: 0 }); // Answered
    expect(questionResponses.has(requestId)).toBe(true); // Not 404
  });

  test('distinguishes between null (unanswered) and answered', () => {
    const reqUnanswered = 'req-waiting';
    const reqAnswered = 'req-done';
    
    questionResponses.set(reqUnanswered, null);
    questionResponses.set(reqAnswered, { answer: 'Complete', optionIndex: 2 });
    
    // Unanswered should return { answered: false }
    const unanswered = questionResponses.get(reqUnanswered);
    expect(unanswered).toBeNull();
    
    // Answered should return { answered: true, answer, optionIndex }
    const answered = questionResponses.get(reqAnswered);
    expect(answered).not.toBeNull();
    expect(answered?.answer).toBe('Complete');
    expect(answered?.optionIndex).toBe(2);
  });

  test('can update response from __type__ to actual typed text', () => {
    const requestId = 'req-typing';
    const threadId = 'thread-typing';
    
    // User clicks "Type answer" button
    questionResponses.set(requestId, { answer: '__type__', optionIndex: -1 });
    pendingTypedAnswers.set(threadId, requestId);
    
    // Later, bot updates with typed text (simulated)
    questionResponses.set(requestId, { answer: 'My typed answer', optionIndex: -1 });
    
    expect(questionResponses.get(requestId)).toEqual({
      answer: 'My typed answer',
      optionIndex: -1,
    });
  });

  test('multiple threads can have pending typed answers', () => {
    pendingTypedAnswers.set('thread-a', 'req-a');
    pendingTypedAnswers.set('thread-b', 'req-b');
    pendingTypedAnswers.set('thread-c', 'req-c');
    
    expect(pendingTypedAnswers.size).toBe(3);
    expect(pendingTypedAnswers.get('thread-a')).toBe('req-a');
    expect(pendingTypedAnswers.get('thread-b')).toBe('req-b');
    expect(pendingTypedAnswers.get('thread-c')).toBe('req-c');
  });

  test('cleanup removes entry from questionResponses', () => {
    const requestId = 'req-cleanup';
    questionResponses.set(requestId, { answer: 'Test', optionIndex: 0 });
    
    expect(questionResponses.has(requestId)).toBe(true);
    
    // Simulate cleanup
    questionResponses.delete(requestId);
    
    expect(questionResponses.has(requestId)).toBe(false);
  });
});
