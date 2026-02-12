# Troubleshooting

## Common Issues

| Problem | Solution |
|---------|----------|
| Bot connects but doesn't respond | Enable **Message Content Intent** in Developer Portal → Bot tab. This is the #1 setup issue. |
| `TokenInvalid` error | Regenerate your bot token in the Developer Portal and update: `tether config set DISCORD_BOT_TOKEN` |
| `DisallowedIntents` error | Enable the required intents in Developer Portal → Bot tab (see [Discord Setup](discord-setup.md#3-configure-privileged-intents)) |
| Bot doesn't receive DMs | Set `ENABLE_DMS=true`: `tether config set ENABLE_DMS true` |
| "Rate limit exceeded" | Adjust `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_MS` (see [Configuration](configuration.md#limits)) |
| Agent command not found | Ensure `claude`/`opencode`/`codex` is installed and on PATH. If running as a service, set `CLAUDE_BIN` / `OPENCODE_BIN` / `CODEX_BIN` to an absolute path (see [Agent Setup](agents.md)). Run `tether start --debug` for detailed binary resolution output |
| Redis connection refused | Start Redis: `redis-server` (or `brew services start redis` on macOS) |
| Bot can't create threads | Check bot has **Create Public Threads** permission in your server |
| `tether start` hangs / does nothing | Check for a stale PID file: `rm -f .tether.pid` then try again |
| Bot responds to wrong channels | Set `ALLOWED_CHANNELS` to restrict which channels the bot listens in |

## Checking Status

```bash
# Is tether running?
tether status

# Is Discord connected?
tether health

# What config is active?
tether config list
```

## Debug Mode

When troubleshooting agent spawn failures or PATH issues, start Tether in debug mode:

```bash
tether start --debug
```

This enables verbose logging across the entire pipeline:

- **Startup summary** — Shows agent type, script paths, working directory, Redis/API config, binary overrides, and PATH
- **Binary resolution** — Shows how each agent binary was found (env override, PATH lookup, candidate paths, npm global)
- **`which` validation** — Detects stale PATH entries where `which` returns a path that no longer exists on disk
- **Spawn diagnostics** — Shows the exact command, args, working directory, and exit code for each agent spawn
- **Worker pipeline** — Shows job details, adapter selection, spawn options, and results for each queued job

Debug output is prefixed with `[prefix:debug]` and tokens/secrets are automatically redacted.

**Tip:** Pipe debug output to a file for easier analysis:

```bash
tether start --debug > /tmp/tether-debug.log 2>&1
```

## Logs

`tether start` logs to stdout. If running in the background:

```bash
# Run with logging
nohup bun run bin/tether.ts start > /tmp/tether.log 2>&1 &

# View logs
tail -f /tmp/tether.log
```

## Agent-Specific Issues

### Claude Code

| Problem | Solution |
|---------|----------|
| `claude: command not found` | Install: `curl -fsSL https://claude.ai/install.sh \| bash` |
| Authentication expired | Run `claude` interactively to re-authenticate |
| Session resume fails | Sessions may expire — new messages will start fresh automatically |

### OpenCode

| Problem | Solution |
|---------|----------|
| `opencode: command not found` | Install: `curl -fsSL https://opencode.ai/install \| bash` |
| `opencode` installed but not found | Set `OPENCODE_BIN` to the full path (e.g. `~/.opencode/bin/opencode`) and restart Tether |
| API key not set | Set your provider key: `export ANTHROPIC_API_KEY=sk-ant-...` or `export OPENAI_API_KEY=sk-...` |

### Codex

| Problem | Solution |
|---------|----------|
| `codex: command not found` | Install: `npm install -g @openai/codex` (requires Node.js 22+) |
| `OPENAI_API_KEY` not set | `export OPENAI_API_KEY=sk-...` |

## Getting Help

If you're stuck:

1. Check `tether config list` — verify your settings and their sources
2. Check `tether health` — verify Discord connectivity
3. Look at the logs for error messages
4. [Open an issue](https://github.com/thesammykins/tether/issues) with the error output
