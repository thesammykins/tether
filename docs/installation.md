# Installation

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| [Bun](https://bun.sh) | 1.1.0+ | `bun --version` |
| [Redis](https://redis.io) | 6+ | `redis-cli ping` |
| Discord bot token | — | [Create one](discord-setup.md) |
| An AI agent CLI | — | [Setup guides](agents.md) |

## Install Tether

### From npm (recommended)

```bash
bun add -g @thesammykins/tether
```

This installs the `tether` CLI globally. Verify:

```bash
tether help
```

### From source

```bash
git clone https://github.com/thesammykins/tether.git
cd tether
bun install
```

When running from source, use `bun run bin/tether.ts` instead of `tether`.

## Quick Setup

### 1. Create your Discord bot

Follow the [Discord Bot Setup](discord-setup.md) guide to create a bot and get your token.

### 2. Install your AI agent

Tether bridges Discord to a CLI agent. You need at least one installed:

| Agent | Install command | Verify |
|-------|----------------|--------|
| [Claude Code](agents.md#claude-code) | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude --version` |
| [OpenCode](agents.md#opencode) | `curl -fsSL https://opencode.ai/install \| bash` | `opencode --version` |
| [Codex](agents.md#codex) | `npm install -g @openai/codex` | `codex --version` |

See [Agent Setup](agents.md) for full instructions including API keys and authentication.

### 3. Configure

**Option A — Interactive setup:**

```bash
tether setup
```

This walks you through token, agent type, and channel configuration.

**Option B — Import from `.env`:**

```bash
cp .env.example .env
# Edit .env with your values
tether config import .env
```

**Option C — Set values directly:**

```bash
tether config set DISCORD_BOT_TOKEN       # prompts for value (hidden input)
tether config set AGENT_TYPE opencode
tether config set ALLOWED_CHANNELS 123456789
```

See [Configuration](configuration.md) for all options.

### 4. Start Redis

```bash
redis-server
```

Or if using Homebrew on macOS:

```bash
brew services start redis
```

### 5. Start Tether

```bash
tether start
```

You should see:

```
[bot] Connecting to Discord gateway (attempt 1)...
[bot] Logged in as YourBot#1234
[worker] Worker started, waiting for jobs...
```

### 6. Test it

In your Discord server, `@mention` the bot:

```
@Tether what time is it?
```

The bot will react with 👀, create a thread, and post the agent's response.

## Letting the Agent Set Itself Up

If you're already running Claude Code or OpenCode in a project, the agent can set up Tether for you:

> "Install @thesammykins/tether and configure it with my Discord bot token. Use opencode as the agent type. My allowed channel is 123456789."

The agent will:
1. Run `bun add -g @thesammykins/tether`
2. Run `tether config set DISCORD_BOT_TOKEN` (you'll need to provide the token)
3. Run `tether config set AGENT_TYPE opencode`
4. Run `tether config set ALLOWED_CHANNELS 123456789`
5. Start the bot with `tether start`

See [Agent Setup](agents.md) for agent-specific instructions on how to have the agent bootstrap Tether.

## Updating

```bash
# npm install
bun add -g @thesammykins/tether@latest

# From source
git pull && bun install
```

## Uninstall

```bash
# Remove the package
bun remove -g @thesammykins/tether

# Remove config (optional)
rm -rf ~/.config/tether
```
