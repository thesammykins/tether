# Configuration

Tether has three layers of configuration, resolved in this order:

1. **Environment variables** (`process.env`, including `.env` auto-loaded by Bun)
2. **Config store** (`~/.config/tether/config.toml` + `secrets.enc`)
3. **Defaults**

The first non-empty value wins.

## Config Store

Tether stores persistent configuration in `~/.config/tether/`:

| File | Contents | Format |
|------|----------|--------|
| `config.toml` | Preferences (ports, agent type, limits) | Plaintext TOML |
| `secrets.enc` | Tokens (`DISCORD_BOT_TOKEN`, `API_TOKEN`) | AES-256-GCM encrypted |

Secrets are encrypted with a password you choose. You'll be prompted for it when reading or writing secrets.

### `tether config` Commands

```bash
tether config set <key> [value]    # Set a value (prompts for secrets)
tether config get <key>            # Get resolved value with source
tether config list                 # Show all values with sources
tether config delete <key>         # Remove a value
tether config import [path]        # Import from .env file (default: ./.env)
tether config path                 # Show config file locations
```

**Examples:**

```bash
# Set a preference
tether config set AGENT_TYPE opencode

# Set a secret (prompts for value + encryption password)
tether config set DISCORD_BOT_TOKEN

# Import everything from .env
tether config import .env

# See where everything comes from
tether config list
```

`config list` output shows the source of each value:

```
[agent]
  AGENT_TYPE                  opencode  (config.toml)
[secrets]
  DISCORD_BOT_TOKEN           ***  (env)
  API_TOKEN                   (encrypted)  (secrets.enc)
[server]
  TETHER_API_HOST             127.0.0.1  (default)
```

## All Configuration Keys

### Secrets (encrypted)

| Key | Description |
|-----|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token (**required**) |
| `API_TOKEN` | HTTP API authentication token (optional) |

### Agent

| Key | Default | Description |
|-----|---------|-------------|
| `AGENT_TYPE` | `claude` | Agent backend: `claude`, `opencode`, `codex` |
| `CLAUDE_WORKING_DIR` | cwd | Default working directory for agent sessions |

### Server

| Key | Default | Description |
|-----|---------|-------------|
| `TETHER_API_HOST` | `127.0.0.1` | HTTP API bind address |
| `TETHER_API_PORT` | `2643` | HTTP API port |

### Redis

| Key | Default | Description |
|-----|---------|-------------|
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

### Security

| Key | Default | Description |
|-----|---------|-------------|
| `ALLOWED_USERS` | (empty = all) | Comma-separated Discord user IDs |
| `ALLOWED_ROLES` | (empty = all) | Comma-separated Discord role IDs (guild only) |
| `ALLOWED_CHANNELS` | (empty = all) | Comma-separated Discord channel IDs (guild only) |
| `CORD_ALLOWED_DIRS` | (empty = any) | Comma-separated allowed working directories |

### Limits

| Key | Default | Description |
|-----|---------|-------------|
| `RATE_LIMIT_REQUESTS` | `5` | Max requests per rate window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `MAX_TURNS_PER_SESSION` | `50` | Max turns per thread/DM session |
| `MAX_SESSION_DURATION_MS` | `3600000` | Max session duration in ms |

### Features

| Key | Default | Description |
|-----|---------|-------------|
| `ENABLE_DMS` | `false` | Allow the bot to respond to direct messages |
| `FORUM_SESSIONS` | `false` | Use forum channel posts instead of text channel threads for sessions |
| `FORUM_CHANNEL_ID` | (empty) | Discord forum channel ID for session posts (required when `FORUM_SESSIONS=true`) |

### Database

| Key | Default | Description |
|-----|---------|-------------|
| `DB_PATH` | `./data/threads.db` | SQLite database path |

### Misc

| Key | Default | Description |
|-----|---------|-------------|
| `TZ` | `UTC` | Timezone for datetime injection into prompts |

## Working Directory

Tether supports per-channel working directories so agents operate in the correct project.

**Channel-level** (persists for all conversations):
```
/cord config dir ~/Code/myproject
```

**Per-message override** (one-time):
```
@bot [/other/project] what files are here?
```

**Resolution order:** message override → channel config → `CLAUDE_WORKING_DIR` → `process.cwd()`

### Directory Allowlist

For multi-user deployments, restrict which directories users can access:

```bash
tether config set CORD_ALLOWED_DIRS "/home/projects,/var/code"
```

Paths outside the allowlist are rejected. If unset, any existing directory is allowed.

## Finding Discord IDs

To get user, role, or channel IDs:

1. Enable **Developer Mode** in Discord: Settings → App Settings → Advanced → Developer Mode
2. Right-click a user, role, or channel → **Copy ID**
