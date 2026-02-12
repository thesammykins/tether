/**
 * Integration tests for Discord REST resilience
 * 
 * Tests timeout handling, 429 retry logic with JSON/header parsing,
 * jittered backoff, and graceful degradation.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { sendToThread, sendTyping } from '../../src/discord.js';
import type { DiscordResult } from '../../src/discord.js';

// Mock fetch globally
const originalFetch = global.fetch;

describe('Discord REST Resilience', () => {
    beforeEach(() => {
        // Ensure token is set
        process.env.DISCORD_BOT_TOKEN = 'test-token';
    });

    afterEach(() => {
        // Restore original fetch
        global.fetch = originalFetch;
    });

    describe('Timeout Handling', () => {
        it('should timeout after 30s and return failure', async () => {
            const startTime = Date.now();
            
            // Mock a slow response that never resolves
            global.fetch = mock(async (url: string, options?: RequestInit) => {
                // Simulate a request that hangs until aborted
                return new Promise((resolve, reject) => {
                    const signal = (options as any)?.signal;
                    if (signal) {
                        signal.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted', 'AbortError'));
                        });
                    }
                    // Never resolve - timeout should abort
                });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test message');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(false);
            expect(result.error).toContain('timed out after 30s');
            expect(elapsed).toBeGreaterThanOrEqual(30000);
            expect(elapsed).toBeLessThan(31000); // Should not take much longer
        }, { timeout: 35000 }); // Increase timeout for this test
    });

    describe('429 Retry with JSON Body', () => {
        it('should retry after delay from JSON retry_after field', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async (url: string, options?: RequestInit) => {
                callCount++;
                
                if (callCount === 1) {
                    // First call: return 429 with JSON body
                    return new Response(
                        JSON.stringify({ retry_after: 1.5 }), // 1.5 seconds
                        {
                            status: 429,
                            headers: { 'Content-Type': 'application/json' },
                        }
                    );
                }
                
                // Second call: success
                return new Response(JSON.stringify({ id: 'msg-123' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
            // Should wait ~1500ms + jitter (0-500ms)
            expect(elapsed).toBeGreaterThanOrEqual(1500);
            expect(elapsed).toBeLessThan(2100); // 1500 + 500 jitter + 100ms margin
        });

        it('should handle float retry_after values correctly', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    return new Response(
                        JSON.stringify({ retry_after: 0.5 }), // 0.5 seconds
                        { status: 429 }
                    );
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(elapsed).toBeGreaterThanOrEqual(500);
            expect(elapsed).toBeLessThan(1100); // 500 + 500 jitter + 100ms margin
        });
    });

    describe('429 Retry with Headers', () => {
        it('should fall back to Retry-After header when no JSON body', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    // Return 429 with Retry-After header (seconds)
                    return new Response('Rate limited', {
                        status: 429,
                        headers: { 'Retry-After': '2' }, // 2 seconds
                    });
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
            // Should wait ~2000ms + jitter
            expect(elapsed).toBeGreaterThanOrEqual(2000);
            expect(elapsed).toBeLessThan(2600);
        });

        it('should fall back to X-RateLimit-Reset-After header', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    return new Response('Rate limited', {
                        status: 429,
                        headers: { 'X-RateLimit-Reset-After': '1.0' },
                    });
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(elapsed).toBeGreaterThanOrEqual(1000);
            expect(elapsed).toBeLessThan(1600);
        });

        it('should prioritize JSON body over headers', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    // JSON body should take priority
                    return new Response(
                        JSON.stringify({ retry_after: 0.5 }),
                        {
                            status: 429,
                            headers: {
                                'Retry-After': '10', // Should be ignored
                                'X-RateLimit-Reset-After': '20', // Should be ignored
                            },
                        }
                    );
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            // Should use 0.5s from JSON, not 10s or 20s from headers
            expect(elapsed).toBeGreaterThanOrEqual(500);
            expect(elapsed).toBeLessThan(1100);
        });

        it('should use default delay when no retry info provided', async () => {
            const startTime = Date.now();
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    // No retry_after in body or headers
                    return new Response('Rate limited', { status: 429 });
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            expect(result.success).toBe(true);
            // Should use default 5000ms + jitter
            expect(elapsed).toBeGreaterThanOrEqual(5000);
            expect(elapsed).toBeLessThan(5600);
        }, { timeout: 10000 }); // Increase timeout for 5s delay
    });

    describe('Retry Storm Prevention', () => {
        it('should give up after 3 retries and return failure', async () => {
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                // Always return 429 with quick retry
                return new Response(
                    JSON.stringify({ message: 'Rate limited', retry_after: 0.1 }),
                    { 
                        status: 429,
                        headers: { 'Content-Type': 'application/json' }
                    }
                );
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Discord API error: 429');
            expect(callCount).toBe(4); // Initial + 3 retries
        }, { timeout: 10000 }); // Needs more time for retries

        it('should succeed after retries if server recovers', async () => {
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1 || callCount === 2) {
                    // First two calls: rate limited
                    return new Response(
                        JSON.stringify({ retry_after: 0.1 }),
                        { status: 429 }
                    );
                }
                
                // Third call: success
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');

            expect(result.success).toBe(true);
            expect(callCount).toBe(3); // First 429, retry 429, retry success
        });

        it('should apply jitter to prevent thundering herd', async () => {
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    return new Response(
                        JSON.stringify({ retry_after: 1.0 }),
                        { status: 429 }
                    );
                }
                
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const startTime = Date.now();
            await sendToThread('thread-123', 'test');
            const elapsed = Date.now() - startTime;

            // Should retry once with jitter
            expect(callCount).toBe(2);
            // Delay should be 1000ms + jitter (0-500ms)
            expect(elapsed).toBeGreaterThanOrEqual(1000);
            expect(elapsed).toBeLessThan(1600);
        });
    });

    describe('Graceful Degradation', () => {
        it('should return failure result instead of throwing on error', async () => {
            global.fetch = mock(async () => {
                return new Response('Internal Server Error', { status: 500 });
            }) as unknown as typeof fetch;

            // Should not throw
            const result = await sendToThread('thread-123', 'test');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Discord API error: 500');
        });

        it('should handle network errors gracefully', async () => {
            global.fetch = mock(async () => {
                throw new Error('Network error');
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', 'test');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
        });
    });

    describe('Message Chunking with Resilience', () => {
        it('should handle chunked messages with retry logic', async () => {
            const longMessage = 'x'.repeat(2500); // Exceeds 2000 char limit
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                // First chunk: rate limited
                if (callCount === 1) {
                    return new Response(
                        JSON.stringify({ retry_after: 0.1 }),
                        { status: 429 }
                    );
                }
                
                // Retry and second chunk: success
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', longMessage);

            expect(result.success).toBe(true);
            expect(callCount).toBe(3); // First chunk (429 + retry), second chunk
        });

        it('should fail entire operation if any chunk fails after retries', async () => {
            const longMessage = 'x'.repeat(2500);
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                // First chunk succeeds
                if (callCount === 1) {
                    return new Response('{}', { status: 200 });
                }
                
                // Second chunk always fails with 429
                return new Response(
                    JSON.stringify({ retry_after: 0.1 }),
                    { status: 429 }
                );
            }) as unknown as typeof fetch;

            const result = await sendToThread('thread-123', longMessage);

            expect(result.success).toBe(false);
            expect(callCount).toBe(5); // First chunk (1) + second chunk (1 + 3 retries)
        });
    });

    describe('sendTyping Resilience', () => {
        it('should apply same timeout and retry logic to typing indicator', async () => {
            let callCount = 0;

            global.fetch = mock(async () => {
                callCount++;
                
                if (callCount === 1) {
                    return new Response(
                        JSON.stringify({ retry_after: 0.1 }),
                        { status: 429 }
                    );
                }
                
                return new Response('', { status: 204 });
            }) as unknown as typeof fetch;

            const result = await sendTyping('channel-123');

            expect(result.success).toBe(true);
            expect(callCount).toBe(2);
        });

        it('should return failure on typing timeout', async () => {
            global.fetch = mock(async (url: string, options?: RequestInit) => {
                return new Promise((resolve, reject) => {
                    const signal = (options as any)?.signal;
                    if (signal) {
                        signal.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted', 'AbortError'));
                        });
                    }
                });
            }) as unknown as typeof fetch;

            const result = await sendTyping('channel-123');

            expect(result.success).toBe(false);
            expect(result.error).toContain('timed out');
        }, { timeout: 35000 }); // Increase timeout for 30s delay
    });
});
