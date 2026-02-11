# @thesammykins/tether

Discord bot that bridges messages to AI coding agents. Supports Claude Code, OpenCode, and Codex CLI.

Fork of [cord](https://github.com/alexknowshtml/cord) with multi-agent support and enhanced features.

## Features

- **Multi-agent support** — Claude Code, OpenCode, Codex (switch via `AGENT_TYPE` env var)
- **Direct messages** — Chat with the bot privately via DMs (opt-in)
- **Access control** — User, role, and channel allowlists
- **Rate limiting** — Per-user sliding window
- **Session management** — Turn limits, duration limits, pause/resume
- **Smart threads** — Auto-naming, channel context for new conversations
- **Acknowledgment** — 👀 reaction on incoming messages
- **Resilient** — Exponential backoff on connection failures

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Redis](https://redis.io) (for BullMQ job queue)
- A Discord bot token ([setup guide below](#discord-bot-setup))
- An AI agent CLI installed on PATH (`claude`, `opencode`, or `codex`)

### Install

```bash
git clone https://github.com/thesammykins/tether.git
cd tether
bun install
```

### Configure

```bash
cp .env.example .env
# Edit .env with your DISCORD_BOT_TOKEN and settings
```

### Run

```bash
bun run start        # Start bot + worker via CLI
# or run separately:
bun run bot          # Discord gateway
bun run worker       # Job processor
```

---

## Discord Bot Setup

Step-by-step guide to creating and configuring your Discord bot.

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (e.g. "Tether")
3. Note the **Application ID** — you'll need it for the invite link

### 2. Create the Bot User

1. In your application, go to the **Bot** tab in the left sidebar
2. Click **Add Bot** (if not already created)
3. Under **Token**, click **Reset Token** and copy it — this is your `DISCORD_BOT_TOKEN`
4. **Store this token securely** — you won't be able to see it again

### 3. Configure Bot Permissions

Under the **Bot** tab, configure these settings:

**Privileged Gateway Intents** (toggle ON):

| Intent | Why |
|--------|-----|
| **Message Content Intent** | Required to read message text (not just metadata) |

> Without Message Content Intent enabled, the bot will connect but never see message contents.

**Bot Permissions** — the bot needs these permissions in your server:

| Permission | Why |
|------------|-----|
| Send Messages | Reply to users |
| Create Public Threads | Create conversation threads |
| Send Messages in Threads | Respond in threads |
| Manage Threads | Rename threads |
| Read Message History | Fetch channel context for new conversations |
| Add Reactions | 👀 acknowledgment emoji |
| Use Slash Commands | `/cord config` command |

### 4. Generate the Invite Link

1. Go to the **OAuth2** tab → **URL Generator**
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select the permissions listed above, or use the permission integer `326417588288` which includes all required permissions
4. Copy the generated URL and open it in your browser
5. Select the server you want to add the bot to and click **Authorize**

### 5. Enable DMs (Optional)

If you want users to be able to DM the bot directly:

1. In `.env`, set `ENABLE_DMS=true`
2. In the Discord Developer Portal → **Bot** tab, make sure **Allow DMs** is not disabled

DM behavior:
- Any message sent to the bot in DMs starts or continues a conversation
- No `@mention` needed — every DM is treated as a prompt
- Sessions persist per-user until manually reset
- Send `!reset` in DMs to start a fresh session
- Only `ALLOWED_USERS` is checked for DMs (roles and channels don't apply)

### 6. Start the Bot

```bash
# Make sure Redis is running
redis-server

# Start tether
bun run start
```

You should see:
```
[bot] Connecting to Discord gateway (attempt 1)...
[bot] Logged in as YourBot#1234
[worker] Worker started, waiting for jobs...
```

### 7. Test It

In your Discord server, `@mention` the bot in any channel:

```
@Tether what time is it?
```

The bot will:
1. React with 👀
2. Create a thread with an auto-generated name
3. Post a "Processing..." status message
4. Forward the prompt to your AI agent
5. Post the response in the thread

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | required | Discord bot token |
| `AGENT_TYPE` | `claude` | Agent backend: `claude`, `opencode`, `codex` |
| `ENABLE_DMS` | `false` | Allow bot to respond to direct messages |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `ALLOWED_USERS` | (empty=all) | Comma-separated Discord user IDs |
| `ALLOWED_ROLES` | (empty=all) | Comma-separated role IDs (guild only) |
| `ALLOWED_CHANNELS` | (empty=all) | Comma-separated channel IDs (guild only) |
| `RATE_LIMIT_REQUESTS` | `5` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `MAX_TURNS_PER_SESSION` | `50` | Max turns per thread/DM session |
| `MAX_SESSION_DURATION_MS` | `3600000` | Max session duration (ms) |
| `CLAUDE_WORKING_DIR` | cwd | Default working directory for agents |
| `DB_PATH` | `./data/threads.db` | SQLite database path |
| `CORD_ALLOWED_DIRS` | (empty=any) | Comma-separated allowed working directories |

### Finding Discord IDs

To get user, role, or channel IDs:
1. Enable **Developer Mode** in Discord: Settings → App Settings → Advanced → Developer Mode
2. Right-click a user, role, or channel and select **Copy ID**

## Agent CLI Requirements

Whichever agent you choose must be installed and available on PATH:
- **Claude Code**: `claude` CLI — [Install guide](https://docs.anthropic.com/en/docs/claude-code)
- **OpenCode**: `opencode` CLI
- **Codex**: `codex` CLI

## Architecture

Tether uses a queue-based architecture for reliable message processing:

```
Discord Bot  →  BullMQ Queue  →  Agent Worker
 (gateway)       (Redis)          (spawns CLI)
```

### Key Components

- **Bot** (`src/bot.ts`) — Discord gateway with middleware pipeline
- **Worker** (`src/worker.ts`) — Job processor using adapter registry
- **Adapters** (`src/adapters/`) — AgentAdapter interface for Claude/OpenCode/Codex
- **Middleware** (`src/middleware/`) — Allowlist, rate-limiter
- **Features** (`src/features/`) — Ack, channel-context, thread-naming, session-limits, pause-resume
- **Queue** (`src/queue.ts`) — BullMQ job queue
- **DB** (`src/db.ts`) — SQLite for thread→session mapping

### Message Flow

**Guild channels:**
1. User `@mentions` bot in Discord channel
2. Bot checks allowlist → rate limiter → pause state
3. Bot creates thread with auto-generated name
4. Bot adds job to BullMQ queue
5. Worker pulls job and spawns agent adapter
6. Adapter runs CLI (`claude`/`opencode`/`codex`) with prompt
7. Worker posts response back to Discord thread

**Direct messages:**
1. User sends message to bot in DMs (no `@mention` needed)
2. Bot checks user allowlist → rate limiter
3. Bot creates or resumes session for this user
4. Bot adds job to BullMQ queue
5. Worker posts response back to the DM channel

### Middleware Pipeline

Messages pass through middleware in this order:

1. **Allowlist** — Block unauthorized users/channels/roles (DMs: user-only check)
2. **Rate Limiter** — Sliding window per-user rate limit
3. **Pause/Resume** — Hold messages if thread is paused (guild threads only)

### Session Management

- **Turn limits** — Max messages per thread/DM session (prevents infinite loops)
- **Duration limits** — Max session lifetime
- **Pause/Resume** — Type `pause` to hold messages, `resume` to continue (threads only)
- **DM Reset** — Type `!reset` in DMs to start a new session
- **Auto-completion** — React with ✅ on last message to mark "Done" (threads only)

## Working Directory Configuration

Tether supports per-channel working directories so agents operate in the correct project context.

**Channel-level configuration** (persists for all conversations in that channel):
```
/cord config dir ~/Code/myproject
```

**Per-message override** (one-time, just for this conversation):
```
@bot [/other/project] what files are here?
```

**Fallback chain**: Message override → Channel config → `CLAUDE_WORKING_DIR` env → `process.cwd()`

### Security: Directory Allowlist

For multi-user deployments, restrict which directories users can access:

```bash
CORD_ALLOWED_DIRS=/home/projects,/var/code
```

If not set, any existing directory is allowed (backward compatible). When set, paths outside the allowlist are rejected.

## Testing

```bash
bun test                     # Run all tests
bun test tests/adapters/     # Adapter tests only
bun test tests/middleware/   # Middleware tests only
bun test tests/features/     # Feature tests only
bun test tests/integration/  # Integration tests only
```

## CLI Commands

See [skills/tether/SKILL.md](./skills/tether/SKILL.md) for full CLI documentation.

Quick reference:
- `tether send <channel> "message"` — Send text message
- `tether embed <channel> "text" --title "T"` — Send formatted embed
- `tether file <channel> ./file.txt` — Send file attachment
- `tether buttons <channel> "prompt" --button label="Yes" id="yes"` — Send interactive buttons
- `tether state <channel> <msgId> done` — Update status message
- `tether dm <user-id> "message"` — Send a DM to a user (proactive outreach)
- `tether dm <user-id> --embed "text" --title "T"` — Send an embed DM
- `tether dm <user-id> --file ./report.md` — Send a file via DM

## HTTP API

Tether exposes an HTTP API on port 2643 for external scripts and webhooks.

See [skills/tether/HTTP-API.md](./skills/tether/HTTP-API.md) for API documentation.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot connects but doesn't respond | Enable **Message Content Intent** in Developer Portal → Bot tab |
| "TokenInvalid" error | Regenerate your bot token in the Developer Portal |
| "DisallowedIntents" error | Enable the required intents in Developer Portal → Bot tab |
| Bot doesn't receive DMs | Set `ENABLE_DMS=true` in `.env` |
| "Rate limit exceeded" | Adjust `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_MS` |
| Agent command not found | Ensure `claude`/`opencode`/`codex` is installed and on PATH |
| Redis connection refused | Start Redis: `redis-server` |
| Bot can't create threads | Check bot has **Create Public Threads** permission in your server |

## Privacy

Tether stores only thread-to-session mappings and channel configuration (working directories). **No message content, user data, or conversation history is persisted.** Messages pass through the Redis queue transiently and are discarded after processing.

## License

MIT
