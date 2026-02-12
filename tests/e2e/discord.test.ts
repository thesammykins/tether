/**
 * E2E tests for Discord bot integration
 * 
 * These tests verify real Discord connectivity and API functionality.
 * Run with: bun test tests/e2e/discord.test.ts
 * 
 * Note: These tests require:
 * - DISCORD_BOT_TOKEN in .env
 * - Active Discord bot with access to test channel
 * - Channel ID: 1471260534900002998
 * - Running Redis server
 * 
 * These tests are SKIPPED by default. Set ENABLE_E2E_TESTS=true to run them.
 */

import { describe, it, expect } from 'bun:test';

// Skip E2E tests by default - they require external dependencies
const skipE2E = process.env.ENABLE_E2E_TESTS !== 'true' || 
                !process.env.DISCORD_BOT_TOKEN || 
                process.env.CI === 'true';

describe.skipIf(skipE2E)('e2e', () => {
  const TEST_CHANNEL_ID = '1471260534900002998';
  const API_PORT = parseInt(process.env.TETHER_API_PORT || '2643');
  const API_HOST = process.env.TETHER_API_HOST || '127.0.0.1';

  describe('API Health Check', () => {
    it('should return valid health status', async () => {
      const response = await fetch(`http://${API_HOST}:${API_PORT}/health`, {
        method: 'GET',
      });

      expect(response.status).toBe(200);
      
      const json = await response.json() as {
        status: string;
        connected: boolean;
        user: string | null;
      };

      expect(json.status).toBe('ok');
      expect(json).toHaveProperty('connected');
      expect(json).toHaveProperty('user');
    });
  });

  describe('Discord Connection', () => {
    it('should connect to Discord and send a message', async () => {
      // Import the bot client
      const { client } = await import('../../src/bot');

      // Wait for client to be ready
      if (!client.isReady()) {
        await new Promise(resolve => {
          client.once('ready', resolve);
          setTimeout(resolve, 5000); // 5s timeout
        });
      }

      expect(client.isReady()).toBe(true);
      expect(client.user).toBeDefined();
      expect(client.user?.tag).toBeDefined();
    });

    it('should send and read a message from test channel', async () => {
      const { client } = await import('../../src/bot');

      // Wait for client to be ready
      if (!client.isReady()) {
        await new Promise(resolve => {
          client.once('ready', resolve);
          setTimeout(resolve, 5000);
        });
      }

      // Fetch test channel
      const channel = await client.channels.fetch(TEST_CHANNEL_ID);
      expect(channel).toBeDefined();
      expect(channel?.isTextBased()).toBe(true);

      if (channel?.isTextBased()) {
        // Send a test message
        const testMessage = `E2E Test: ${new Date().toISOString()}`;
        const sentMessage = await (channel as any).send(testMessage);
        expect(sentMessage).toBeDefined();
        expect(sentMessage.content).toBe(testMessage);

        // Read back the message
        const fetchedMessage = await (channel as any).messages.fetch(sentMessage.id);
        expect(fetchedMessage).toBeDefined();
        expect(fetchedMessage.content).toBe(testMessage);

        // Clean up - delete the test message
        await sentMessage.delete();
      }
    });
  });

  describe('API Commands', () => {
    it('should send message via API /command endpoint', async () => {
      const { client } = await import('../../src/bot');

      // Wait for client to be ready
      if (!client.isReady()) {
        await new Promise(resolve => {
          client.once('ready', resolve);
          setTimeout(resolve, 5000);
        });
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Authorization header if API_TOKEN is set
      if (process.env.API_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.API_TOKEN}`;
      }

      const response = await fetch(`http://${API_HOST}:${API_PORT}/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          command: 'send-to-thread',
          args: {
            thread: TEST_CHANNEL_ID,
            message: `E2E API Test: ${new Date().toISOString()}`,
          },
        }),
      });

      expect(response.status).toBe(200);
      
      const json = await response.json() as {
        success: boolean;
        messageId: string;
      };

      expect(json.success).toBe(true);
      expect(json.messageId).toBeDefined();

      // Clean up - fetch and delete the message
      const channel = await client.channels.fetch(TEST_CHANNEL_ID);
      if (channel?.isTextBased()) {
        const message = await channel.messages.fetch(json.messageId);
        await message.delete();
      }
    });
  });
});
