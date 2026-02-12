# Architecture

## Overview

Tether uses a queue-based architecture for reliable, decoupled message processing:

```
Discord Bot  →  BullMQ Queue  →  Agent Worker
 (gateway)       (Redis)          (spawns CLI)
```

The bot handles Discord events, the queue provides durability and backpressure, and the worker spawns the appropriate agent CLI to process prompts.

## Components

| Component | Path | Role |
|-----------|------|------|
| **Bot** | `src/bot.ts` | Discord gateway — receives messages, runs middleware, enqueues jobs |
| **Worker** | `src/worker.ts` | Job processor — pulls jobs from queue, spawns agent adapter, posts responses |
| **Adapters** | `src/adapters/` | `AgentAdapter` interface — wraps Claude/OpenCode/Codex CLIs |
| **Middleware** | `src/middleware/` | Request pipeline — allowlist, rate limiter |
| **Features** | `src/features/` | Ack emoji, channel context, thread naming, session limits, pause/resume |
| **Queue** | `src/queue.ts` | BullMQ job queue backed by Redis |
| **Database** | `src/db.ts` | SQLite — thread→session mapping, channel config |
| **Config** | `src/config.ts` | Config store — TOML preferences + AES-256-GCM encrypted secrets |
| **CLI** | `bin/tether.ts` | Entry point — all `tether` commands |

## Message Flow

### Guild Channels

1. User `@mentions` the bot in a Discord channel
2. Bot runs the middleware pipeline (allowlist → rate limiter → pause check)
3. Bot creates a thread with an auto-generated name
4. Bot adds a job to the BullMQ queue
5. Worker pulls the job and spawns the configured agent adapter
6. Adapter runs the CLI (`claude`/`opencode`/`codex`) with the prompt
7. Worker posts the agent's response back to the Discord thread

### Direct Messages

1. User sends a message to the bot in DMs (no `@mention` needed)
2. Bot checks user allowlist → rate limiter
3. Bot creates or resumes a session for this user
4. Bot adds a job to the BullMQ queue
5. Worker posts the response back to the DM channel

### BRB Mode

When a user sends `brb` in a thread:

1. The session is flagged as "BRB" — the user is away
2. If the agent needs to ask a question, it calls `tether ask` instead of its built-in prompt
3. `tether ask` sends interactive buttons to the Discord thread
4. The CLI blocks until someone clicks a button or types a free-text answer
5. The answer is returned to the agent via stdout

## Middleware Pipeline

Messages pass through middleware in order. Each middleware can block the message.

```
Message → Allowlist → Rate Limiter → Pause/Resume → Queue
```

1. **Allowlist** (`src/middleware/allowlist.ts`) — Block unauthorized users, channels, or roles. DMs only check `ALLOWED_USERS`.
2. **Rate Limiter** (`src/middleware/rate-limiter.ts`) — Sliding window per-user rate limit. Configurable via `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW_MS`.
3. **Pause/Resume** (`src/features/pause-resume.ts`) — Hold messages if the thread is paused (guild threads only). Users type `pause`/`resume` to toggle.

## Adapter System

Adapters implement the `AgentAdapter` interface (`src/adapters/types.ts`):

```typescript
interface AgentAdapter {
  readonly name: string;
  spawn(options: SpawnOptions): Promise<SpawnResult>;
}
```

The adapter registry (`src/adapters/registry.ts`) maps `AGENT_TYPE` to the correct adapter. Each adapter handles:

- CLI argument construction
- Session ID management (new vs. resume)
- Output parsing (JSON → text)
- Working directory configuration

## Session Management

- **Turn limits** — Max messages per thread/DM session (`MAX_TURNS_PER_SESSION`)
- **Duration limits** — Max session lifetime (`MAX_SESSION_DURATION_MS`)
- **Pause/Resume** — Type `pause` to hold messages, `resume` to continue (threads only)
- **DM Reset** — Type `!reset` in DMs to start a new session
- **Auto-completion** — React with ✅ on the last message to mark "Done" (threads only)

## Config Resolution

Configuration values are resolved in priority order:

```
Environment variable → Config store (TOML/encrypted) → Default
```

See [Configuration](configuration.md) for the full key reference.

## Data Storage

| Store | Path | Contents |
|-------|------|----------|
| SQLite | `./data/threads.db` | Thread→session mapping, channel working dirs |
| Config | `~/.config/tether/config.toml` | Preferences (plaintext TOML) |
| Secrets | `~/.config/tether/secrets.enc` | Tokens (AES-256-GCM encrypted) |
| Redis | (in-memory) | BullMQ job queue |

### Privacy

Tether stores only thread-to-session mappings and channel configuration. **No message content, user data, or conversation history is persisted.** Messages pass through the Redis queue transiently and are discarded after processing.
