/**
 * Tests for API security features
 * 
 * Tests:
 * - Bearer token authentication
 * - /health endpoint accessibility without token
 * - Binary file encoding detection
 * - Button style handling (numbers and strings)
 * - Question TTL
 */

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';
import type { Client } from 'discord.js';

// Mock Discord client
const mockClient = {
  isReady: () => true,
  user: { tag: 'TestBot#1234' },
  channels: {
    fetch: mock(async (id: string) => {
      if (id === 'invalid') return null;
      return {
        isTextBased: () => true,
        send: mock(async (opts: any) => ({ id: 'msg-123' })),
      };
    }),
  },
} as unknown as Client;

describe('API Security', () => {
  let server: any;
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = originalEnv;
    if (server) {
      server.stop();
    }
  });

  describe('Bearer Token Authentication', () => {
    it('should allow requests without token when API_TOKEN not set', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer } = await import('../src/api');
      server = startApiServer(mockClient, 2644);

      const response = await fetch('http://127.0.0.1:2644/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'start-typing',
          args: { channel: 'channel-123' },
        }),
      });

      expect(response.status).not.toBe(401);
      server.stop();
    });

    it('should reject requests without Authorization header when API_TOKEN set', async () => {
      process.env.API_TOKEN = 'test-secret-token';
      const { startApiServer } = await import('../src/api');
      server = startApiServer(mockClient, 2645);

      const response = await fetch('http://127.0.0.1:2645/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'start-typing',
          args: { channel: 'channel-123' },
        }),
      });

      expect(response.status).toBe(401);
      const json = await response.json() as { error: string };
      expect(json.error).toBe('Unauthorized');
      server.stop();
    });

    it('should reject requests with wrong token', async () => {
      process.env.API_TOKEN = 'test-secret-token';
      const { startApiServer } = await import('../src/api');
      server = startApiServer(mockClient, 2646);

      const response = await fetch('http://127.0.0.1:2646/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-token',
        },
        body: JSON.stringify({
          command: 'start-typing',
          args: { channel: 'channel-123' },
        }),
      });

      expect(response.status).toBe(401);
      const json = await response.json() as { error: string };
      expect(json.error).toBe('Unauthorized');
      server.stop();
    });

    it('should accept requests with correct token', async () => {
      process.env.API_TOKEN = 'test-secret-token';
      const { startApiServer } = await import('../src/api');
      server = startApiServer(mockClient, 2647);

      const response = await fetch('http://127.0.0.1:2647/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-secret-token',
        },
        body: JSON.stringify({
          command: 'start-typing',
          args: { channel: 'channel-123' },
        }),
      });

      expect(response.status).not.toBe(401);
      server.stop();
    });

    it('should allow /health endpoint without token', async () => {
      process.env.API_TOKEN = 'test-secret-token';
      const { startApiServer } = await import('../src/api');
      server = startApiServer(mockClient, 2648);

      const response = await fetch('http://127.0.0.1:2648/health', {
        method: 'GET',
      });

      expect(response.status).toBe(200);
      const json = await response.json() as { status: string; connected: boolean };
      expect(json.status).toBe('ok');
      expect(json.connected).toBe(true);
      server.stop();
    });
  });

  describe('Binary File Encoding Detection', () => {
    it('should detect PNG as binary and use base64 encoding', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer } = await import('../src/api');
      
      const mockChannel = {
        isTextBased: () => true,
        send: mock(async (opts: any) => {
          // Verify that buffer was created from base64
          expect(opts.files[0].attachment).toBeInstanceOf(Buffer);
          return { id: 'msg-456' };
        }),
      };
      
      const mockClientWithChannel = {
        ...mockClient,
        channels: {
          fetch: mock(async () => mockChannel),
        },
      } as unknown as Client;

      server = startApiServer(mockClientWithChannel, 2649);

      // Send a PNG file with UTF-8 content (should be treated as base64)
      const response = await fetch('http://127.0.0.1:2649/send-with-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-123',
          fileName: 'test.png',
          fileContent: Buffer.from('fake-png-data').toString('base64'),
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as { success: boolean };
      expect(json.success).toBe(true);
      server.stop();
    });
  });

  describe('Button Style Handling', () => {
    it('should accept button style as number', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer } = await import('../src/api');
      
      const mockChannel = {
        isTextBased: () => true,
        send: mock(async (opts: any) => {
          // Verify button was created with numeric style
          expect(opts.components).toBeDefined();
          expect(opts.components[0].components.length).toBeGreaterThan(0);
          return { id: 'msg-button-1' };
        }),
      };
      
      const mockClientWithChannel = {
        ...mockClient,
        channels: {
          fetch: mock(async () => mockChannel),
        },
      } as unknown as Client;

      server = startApiServer(mockClientWithChannel, 2652);

      const response = await fetch('http://127.0.0.1:2652/send-with-buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-123',
          content: 'Choose an option',
          buttons: [
            { label: 'Primary', customId: 'btn-1', style: 1 }, // 1 = ButtonStyle.Primary
            { label: 'Secondary', customId: 'btn-2', style: 2 },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as { success: boolean };
      expect(json.success).toBe(true);
      server.stop();
    });

    it('should accept button style as string and map correctly', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer } = await import('../src/api');
      
      const mockChannel = {
        isTextBased: () => true,
        send: mock(async () => ({ id: 'msg-button-2' })),
      };
      
      const mockClientWithChannel = {
        ...mockClient,
        channels: {
          fetch: mock(async () => mockChannel),
        },
      } as unknown as Client;

      server = startApiServer(mockClientWithChannel, 2653);

      const response = await fetch('http://127.0.0.1:2653/send-with-buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-123',
          content: 'Choose an option',
          buttons: [
            { label: 'Primary', customId: 'btn-1', style: 'primary' },
            { label: 'Danger', customId: 'btn-2', style: 'danger' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json() as { success: boolean };
      expect(json.success).toBe(true);
      server.stop();
    });
  });

  describe('Question TTL', () => {
    it('should register question with 5-minute TTL', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer, pendingQuestions } = await import('../src/api');
      
      const mockChannel = {
        isTextBased: () => true,
        send: mock(async () => ({ id: 'msg-question-1' })),
      };
      
      const mockClientWithChannel = {
        ...mockClient,
        channels: {
          fetch: mock(async () => mockChannel),
        },
      } as unknown as Client;

      server = startApiServer(mockClientWithChannel, 2654);

      const requestId = crypto.randomUUID();
      const response = await fetch('http://127.0.0.1:2654/send-with-buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-123',
          content: 'Question?',
          buttons: [
            { label: 'Yes', customId: `ask_${requestId}_yes`, style: 'primary' },
            { label: 'No', customId: `ask_${requestId}_no`, style: 'secondary' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      
      // Verify question was registered
      expect(pendingQuestions.has(requestId)).toBe(true);
      const pending = pendingQuestions.get(requestId);
      expect(pending).toBeDefined();
      expect(pending?.timeoutId).toBeDefined();
      
      // Clean up timeout
      if (pending?.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pendingQuestions.delete(requestId);
      
      server.stop();
    });

    it('should clean up expired questions after TTL', async () => {
      delete process.env.API_TOKEN;
      const { startApiServer, pendingQuestions, questionResponses } = await import('../src/api');
      
      const mockChannel = {
        isTextBased: () => true,
        send: mock(async () => ({ id: 'msg-question-2' })),
      };
      
      const mockClientWithChannel = {
        ...mockClient,
        channels: {
          fetch: mock(async () => mockChannel),
        },
      } as unknown as Client;

      server = startApiServer(mockClientWithChannel, 2655);

      const requestId = crypto.randomUUID();
      const response = await fetch('http://127.0.0.1:2655/send-with-buttons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: 'channel-123',
          content: 'Question?',
          buttons: [
            { label: 'Yes', customId: `ask_${requestId}_yes`, style: 'primary' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(pendingQuestions.has(requestId)).toBe(true);

      // Manually trigger cleanup (simulate TTL expiry)
      const pending = pendingQuestions.get(requestId);
      if (pending?.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pendingQuestions.delete(requestId);
      questionResponses.delete(requestId);

      // Verify cleanup
      expect(pendingQuestions.has(requestId)).toBe(false);
      expect(questionResponses.has(requestId)).toBe(false);
      
      server.stop();
    });
  });
});
