# AGENTS

This file guides agentic coding assistants working in this repository.
Keep changes minimal and follow existing patterns in nearby files.
Use these commands and conventions unless a task explicitly says otherwise.

## Project overview
- Bun runtime with TypeScript (ESM, no build step).
- Discord.js bot plus BullMQ worker with Redis queue.
- SQLite via bun:sqlite for thread and channel state.
- CLI entrypoint at bin/tether.ts; HTTP API in src/api.ts.

## Key paths
- src/bot.ts: Discord gateway, threads, middleware, session creation.
- src/worker.ts: queue consumer, adapter spawning, Discord replies.
- src/adapters/: CLI adapters for claude, opencode, codex.
- src/middleware/: allowlist and rate limit checks.
- src/features/: ack, BRB, channel context, session limits, pause/resume.
- src/config.ts: config store and encrypted secrets handling.
- src/db.ts: SQLite schema and helpers.
- bin/tether.ts: CLI that calls the HTTP API.
- tests/: unit, integration, and e2e tests.

## Commands
### Install
- bun install

### Run (local dev)
- bun run bin/tether.ts start
- bun run bin/tether.ts status
- bun run bin/tether.ts health
- bun run bin/tether.ts stop
- bun run src/bot.ts
- bun run src/worker.ts

### Tests
- bun test
- bun test tests/features/
- bun test tests/features/thread-naming.test.ts
- bun test tests/integration/worker.test.ts

### E2E tests (real Discord)
- ENABLE_E2E_TESTS=true DISCORD_BOT_TOKEN=... bun test tests/e2e/discord.test.ts
- Requires Redis running and access to the hard-coded test channel in tests/e2e/discord.test.ts.

### Lint / format / build
- No lint or format scripts are configured in package.json.
- No build step is configured; code runs directly with Bun.

## Runtime dependencies
- Redis is required for queue processing (REDIS_HOST/REDIS_PORT).
- DISCORD_BOT_TOKEN must be set for the bot to start.
- Optional API_TOKEN protects HTTP endpoints except /health.
- ENABLE_DMS gates DM behavior (default off).

## Config quick list
- AGENT_TYPE: claude, opencode, codex.
- DISCORD_BOT_TOKEN, API_TOKEN: secrets stored in encrypted config.
- TETHER_API_HOST, TETHER_API_PORT: HTTP API bind settings.
- REDIS_HOST, REDIS_PORT: BullMQ connection.
- RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS: rate limiter.
- MAX_TURNS_PER_SESSION, MAX_SESSION_DURATION_MS: session limits.
- CORD_ALLOWED_DIRS, ALLOWED_USERS/ROLES/CHANNELS: access controls.
- CLAUDE_WORKING_DIR, DB_PATH, TZ: misc runtime settings.

## Release and publish
- GitHub Actions publishes on release (see .github/workflows/publish.yml).
- npm publish uses OIDC with provenance; no local release script is defined.

## Code style

### Language and modules
- ESM only; package.json sets "type": "module".
- Use .js extensions in local import specifiers (example: './db.js').
- Use import type for type-only imports.
- Prefer Bun APIs when already used (Bun.spawn, Bun.serve, bun:sqlite).

### Formatting
- Single quotes for strings.
- Use semicolons and trailing commas in multiline lists.
- Respect file-local indentation (some files use 2 spaces, others 4).
- Keep one statement per line; wrap long argument lists.

### Types and safety
- TypeScript strict mode is enabled (tsconfig.json).
- Avoid any in new code; prefer unknown and narrow.
- Do not use @ts-ignore / @ts-expect-error or "as any".
- For dynamic objects, prefer Record<string, unknown> with explicit parsing.
- Parse env numbers with parseInt and a fallback string.

### Naming conventions
- camelCase for variables and functions.
- PascalCase for classes, types, and interfaces.
- UPPER_SNAKE for env vars and module-level constants.
- File names follow kebab-case in src/features and src/middleware.
- Test files end with .test.ts under tests/.

### Error handling and logging
- Handle errors explicitly; include useful context.
- Do not swallow errors silently; if intentionally ignored, add a short comment.
- Use log prefixes consistent with each module (e.g. [bot], [worker], [api]).
- Surface fatal startup errors with process.exit(1).

### Imports and structure
- Order imports as: builtins (fs/path/os/crypto), third-party, local.
- Keep related helpers near usage; avoid deep nesting.
- Prefer pure functions for feature logic in src/features/ and src/middleware/.

### Config and environment
- Configuration keys and defaults live in src/config.ts; update CONFIG_KEYS when adding new keys.
- Bun auto-loads .env into process.env; read from process.env with sensible defaults.
- Secrets are stored via tether config set; do not commit tokens or secrets.
- When adding new config, update docs/configuration.md.

### Discord behavior
- Always check allowlist and rate limit before processing messages.
- DM handling is gated by ENABLE_DMS; keep DM-specific logic behind that flag.
- Thread handling assumes thread.id is the session key; do not change without migration.
- For "Type answer" flow, use pendingTypedAnswers and questionResponses.
- Use TextChannel or ThreadChannel guards before sending.

### Queue and worker
- Use the BullMQ queue named "claude" and ClaudeJob typing from src/queue.ts.
- Worker must update session_id when adapters return a new session id.
- Keep BRB logic in worker by injecting tether ask guidance.

### Database usage
- Use db.query(...).get() or .all() with parameterized SQL.
- Treat null results explicitly.
- Migrations run at startup in src/db.ts; keep them idempotent.
- Keep in-memory caches small and time-bounded.

### CLI conventions
- bin/tether.ts is the CLI entrypoint with a Bun shebang.
- Prefer API calls through /command and /send-with-* endpoints in src/api.ts.
- Keep CLI output terse and actionable.
- When adding CLI commands, update docs/cli.md.

### Tests
- Use bun:test (describe/it/test, expect, mock).
- Integration tests live under tests/integration.
- Feature and middleware tests live under tests/features and tests/middleware.
- E2E tests are skipped unless ENABLE_E2E_TESTS=true and DISCORD_BOT_TOKEN is set.

## Cursor/Copilot rules
- No .cursorrules, .cursor/rules/, or .github/copilot-instructions.md files were found in this repo.
