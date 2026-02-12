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
import { isAway } from './features/brb.js';
import { updateSessionId } from './db.js';
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
        const { prompt, threadId, sessionId, resume, username, workingDir, channelContext } = job.data;

        log(`Processing job ${job.id} for ${username}`);
        log(`Session: ${sessionId}, Resume: ${resume}`);

        try {
            // Get the configured adapter and spawn
            const adapter = getAdapter();
            log(`Using adapter: ${adapter.name}`);

            // Prepend channel context if provided (new conversations only)
            let effectivePrompt = prompt;
            if (channelContext) {
                effectivePrompt = `${channelContext}\n\n${effectivePrompt}`;
            }

            // If user is away (BRB mode), prepend guidance to use tether ask CLI
            if (isAway(threadId)) {
                const brbPrefix = [
                    '[IMPORTANT: The user is currently away from this conversation.',
                    'If you need to ask them a question or get their input, DO NOT use your built-in question/approval tools.',
                    'Instead, use the tether CLI:',
                    '',
                    `  tether ask ${threadId} "Your question here" --option "Option A" --option "Option B"`,
                    '',
                    'This will send interactive buttons to Discord and block until the user responds.',
                    'The selected option will be printed to stdout.',
                    `Thread ID for this conversation: ${threadId}]`,
                ].join('\n');
                effectivePrompt = `${brbPrefix}\n\n${prompt}`;
                log(`BRB mode active for thread ${threadId} — injected tether ask guidance`);
            }

            const result = await adapter.spawn({
                prompt: effectivePrompt,
                sessionId,
                resume,
                workingDir,
            });

            // Persist session ID if adapter returned one and it differs from current
            if (result.sessionId && result.sessionId !== sessionId) {
                updateSessionId(threadId, result.sessionId);
                log(`Updated session ID for thread ${threadId}: ${result.sessionId}`);
            }

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
