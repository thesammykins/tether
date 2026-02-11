/**
 * Worker - Processes Claude jobs from the queue
 *
 * This is where the magic happens:
 * 1. Pulls jobs from the queue
 * 2. Spawns the configured agent adapter (Claude/OpenCode/Codex)
 * 3. Posts the response back to Discord
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getAdapter } from './adapters/registry.js';
import { sendToThread } from './discord.js';
import type { ClaudeJob } from './queue.js';

const log = (msg: string) => process.stdout.write(`[worker] ${msg}\n`);

const connection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});

const worker = new Worker<ClaudeJob>(
    'claude',
    async (job: Job<ClaudeJob>) => {
        const { prompt, threadId, sessionId, resume, username, workingDir } = job.data;

        log(`Processing job ${job.id} for ${username}`);
        log(`Session: ${sessionId}, Resume: ${resume}`);

        try {
            // Get the configured adapter and spawn
            const adapter = getAdapter();
            log(`Using adapter: ${adapter.name}`);

            const result = await adapter.spawn({
                prompt,
                sessionId,
                resume,
                workingDir,
            });

            // Send response to Discord thread
            await sendToThread(threadId, result.output);

            log(`Job ${job.id} completed`);
            return { success: true, responseLength: result.output.length };

        } catch (error) {
            log(`Job ${job.id} failed: ${error}`);

            // Send error message to thread
            await sendToThread(
                threadId,
                `Something went wrong. Try again?\n\`\`\`${error}\`\`\``
            );

            throw error; // Re-throw for BullMQ retry logic
        }
    },
    {
        connection,
        concurrency: 2, // Process up to 2 jobs at once
    }
);

worker.on('completed', (job) => {
    log(`Job ${job?.id} completed`);
});

worker.on('failed', (job, err) => {
    log(`Job ${job?.id} failed: ${err.message}`);
});

log('Worker started, waiting for jobs...');

export { worker };
