# @thesammykins/tether

[![npm version](https://img.shields.io/npm/v/@thesammykins/tether)](https://www.npmjs.com/package/@thesammykins/tether)
[![license](https://img.shields.io/npm/l/@thesammykins/tether)](./LICENSE)

Discord bot that bridges messages to AI coding agents. Supports Claude Code, OpenCode, and Codex CLI.

Fork of [cord](https://github.com/alexknowshtml/cord) with multi-agent support and enhanced features.

## Features

- **Multi-agent support** — Claude Code, OpenCode, Codex (switch via config)
- **BRB mode** — Agent asks questions via Discord buttons when you're away
- **Direct messages** — Chat with the bot privately via DMs
- **Encrypted config** — `tether config` stores tokens with AES-256-GCM encryption
- **Access control** — User, role, and channel allowlists
- **Rate limiting** — Per-user sliding window
- **Session management** — Turn limits, duration limits, pause/resume
- **Smart threads** — Auto-naming, channel context for new conversations
- **Resilient** — Exponential backoff on connection failures

## Quick Start

```bash
# Install
bun add -g @thesammykins/tether

# Configure
tether config set DISCORD_BOT_TOKEN     # paste token (hidden input)
tether config set AGENT_TYPE claude      # or: opencode, codex

# Start Redis + Tether
redis-server &
tether start
```

Then `@mention` the bot in your Discord server.

## Documentation

| Guide | Description |
|-------|-------------|
| **[Installation](docs/installation.md)** | Prerequisites, install methods, quick setup |
| **[Discord Setup](docs/discord-setup.md)** | Bot creation, permissions, intents, invite link |
| **[Agent Setup](docs/agents.md)** | Claude Code / OpenCode / Codex install and auth |
| **[Configuration](docs/configuration.md)** | All config keys, encrypted secrets, resolution chain |
| **[CLI Reference](docs/cli.md)** | Every `tether` command with examples |
| **[Architecture](docs/architecture.md)** | System design, message flow, middleware pipeline |
| **[Troubleshooting](docs/troubleshooting.md)** | Common problems and solutions |
| **[HTTP API](skills/tether/HTTP-API.md)** | REST API for external scripts and webhooks |

## Testing

```bash
bun test                     # Run all tests
bun test tests/adapters/     # Adapter tests only
bun test tests/middleware/   # Middleware tests only
bun test tests/features/     # Feature tests only
```

## Privacy

No message content or user data is stored. Only thread-to-session mappings and channel config persist. Messages pass through Redis transiently and are discarded after processing.

## License

MIT
