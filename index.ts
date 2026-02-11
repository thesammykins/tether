/**
 * Cord - Discord to Claude Code bridge
 *
 * A simple bridge that connects Discord to Claude Code CLI.
 *
 * Start the bot:     bun run src/bot.ts
 * Start the worker:  bun run src/worker.ts
 *
 * Or run both:       bun run start
 */

console.log('Cord - Discord to Claude Code bridge');
console.log('');
console.log('To start the system:');
console.log('  1. Start Redis:      redis-server');
console.log('  2. Start the bot:    bun run src/bot.ts');
console.log('  3. Start the worker: bun run src/worker.ts');
console.log('');
console.log('Environment variables:');
console.log('  DISCORD_BOT_TOKEN  - Your Discord bot token (required)');
console.log('  REDIS_HOST         - Redis host (default: localhost)');
console.log('  REDIS_PORT         - Redis port (default: 6379)');
console.log('  CLAUDE_WORKING_DIR - Working directory for Claude (default: cwd)');
console.log('  DB_PATH            - SQLite database path (default: ./data/threads.db)');
