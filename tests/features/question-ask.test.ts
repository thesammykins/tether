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
    questionResponses.set(requestId, {
      value: { answer: 'Option A', optionIndex: 0 },
      createdAt: Date.now(),
    });
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)?.value).toEqual({ answer: 'Option A', optionIndex: 0 });
  });

  test('can store null in questionResponses (unanswered)', () => {
    const requestId = 'test-request-2';
    questionResponses.set(requestId, {
      value: null,
      createdAt: Date.now(),
    });
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)?.value).toBeNull();
  });

  test('can track typed answers in pendingTypedAnswers', () => {
    const threadId = 'thread-123';
    const requestId = 'request-456';
    pendingTypedAnswers.set(threadId, {
      value: requestId,
      createdAt: Date.now(),
    });
    
    expect(pendingTypedAnswers.has(threadId)).toBe(true);
    expect(pendingTypedAnswers.get(threadId)?.value).toBe(requestId);
  });

  test('stores regular button option response', () => {
    const requestId = 'req-abc123';
    const response = { answer: 'Option A', optionIndex: 0 };
    
    questionResponses.set(requestId, {
      value: response,
      createdAt: Date.now(),
    });
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)?.value).toEqual(response);
  });

  test('stores __type__ option response', () => {
    const requestId = 'req-def456';
    const threadId = 'thread-789';
    
    // Simulate user clicking "Type answer" button
    questionResponses.set(requestId, {
      value: { answer: '__type__', optionIndex: -1 },
      createdAt: Date.now(),
    });
    pendingTypedAnswers.set(threadId, {
      value: requestId,
      createdAt: Date.now(),
    });
    
    expect(questionResponses.has(requestId)).toBe(true);
    expect(questionResponses.get(requestId)?.value).toEqual({
      answer: '__type__',
      optionIndex: -1,
    });
    expect(pendingTypedAnswers.has(threadId)).toBe(true);
    expect(pendingTypedAnswers.get(threadId)?.value).toBe(requestId);
  });

  test('handles multiple requests to different requestIds', () => {
    const req1 = 'req-001';
    const req2 = 'req-002';

    questionResponses.set(req1, {
      value: { answer: 'Yes', optionIndex: 0 },
      createdAt: Date.now(),
    });
    questionResponses.set(req2, {
      value: { answer: 'No', optionIndex: 1 },
      createdAt: Date.now(),
    });

    expect(questionResponses.size).toBe(2);
    expect(questionResponses.get(req1)?.value).toEqual({ answer: 'Yes', optionIndex: 0 });
    expect(questionResponses.get(req2)?.value).toEqual({ answer: 'No', optionIndex: 1 });
  });

  test('can check if requestId exists (for 404 logic)', () => {
    const requestId = 'req-exists';
    
    expect(questionResponses.has(requestId)).toBe(false); // 404
    
    questionResponses.set(requestId, {
      value: null,
      createdAt: Date.now(),
    }); // Register but unanswered
    expect(questionResponses.has(requestId)).toBe(true); // Not 404
    
    questionResponses.set(requestId, {
      value: { answer: 'Done', optionIndex: 0 },
      createdAt: Date.now(),
    }); // Answered
    expect(questionResponses.has(requestId)).toBe(true); // Not 404
  });

  test('distinguishes between null (unanswered) and answered', () => {
    const reqUnanswered = 'req-waiting';
    const reqAnswered = 'req-done';
    
    questionResponses.set(reqUnanswered, {
      value: null,
      createdAt: Date.now(),
    });
    questionResponses.set(reqAnswered, {
      value: { answer: 'Complete', optionIndex: 2 },
      createdAt: Date.now(),
    });
    
    // Unanswered should return { answered: false }
    const unanswered = questionResponses.get(reqUnanswered);
    expect(unanswered?.value).toBeNull();
    
    // Answered should return { answered: true, answer, optionIndex }
    const answered = questionResponses.get(reqAnswered);
    expect(answered?.value).not.toBeNull();
    expect(answered?.value?.answer).toBe('Complete');
    expect(answered?.value?.optionIndex).toBe(2);
  });

  test('can update response from __type__ to actual typed text', () => {
    const requestId = 'req-typing';
    const threadId = 'thread-typing';
    
    // User clicks "Type answer" button
    questionResponses.set(requestId, {
      value: { answer: '__type__', optionIndex: -1 },
      createdAt: Date.now(),
    });
    pendingTypedAnswers.set(threadId, {
      value: requestId,
      createdAt: Date.now(),
    });
    
    // Later, bot updates with typed text (simulated)
    questionResponses.set(requestId, {
      value: { answer: 'My typed answer', optionIndex: -1 },
      createdAt: Date.now(),
    });
    
    expect(questionResponses.get(requestId)?.value).toEqual({
      answer: 'My typed answer',
      optionIndex: -1,
    });
  });

  test('multiple threads can have pending typed answers', () => {
    pendingTypedAnswers.set('thread-a', {
      value: 'req-a',
      createdAt: Date.now(),
    });
    pendingTypedAnswers.set('thread-b', {
      value: 'req-b',
      createdAt: Date.now(),
    });
    pendingTypedAnswers.set('thread-c', {
      value: 'req-c',
      createdAt: Date.now(),
    });
    
    expect(pendingTypedAnswers.size).toBe(3);
    expect(pendingTypedAnswers.get('thread-a')?.value).toBe('req-a');
    expect(pendingTypedAnswers.get('thread-b')?.value).toBe('req-b');
    expect(pendingTypedAnswers.get('thread-c')?.value).toBe('req-c');
  });

  test('cleanup removes entry from questionResponses', () => {
    const requestId = 'req-cleanup';
    questionResponses.set(requestId, {
      value: { answer: 'Test', optionIndex: 0 },
      createdAt: Date.now(),
    });
    
    expect(questionResponses.has(requestId)).toBe(true);
    
    // Simulate cleanup
    questionResponses.delete(requestId);
    
    expect(questionResponses.has(requestId)).toBe(false);
  });
});
