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

### Security & Access Control

Tether supports restricting who can interact with the bot using allowlists. If none are configured, the bot responds to all users.

#### User Allowlist

Restrict the bot to only respond to specific Discord users:

```bash
# Set allowed users (comma-separated Discord user IDs)
tether config set ALLOWED_USERS 123456789012345678,987654321098765432
```

**How to find your Discord user ID:**

1. Enable **Developer Mode** in Discord: Settings → App Settings → Advanced → Developer Mode
2. Right-click on your username (or any user) → **Copy ID**

When `ALLOWED_USERS` is set, only users in the list can interact with the bot. This works in both guild channels and DMs.

#### Role and Channel Allowlists

For guild (server) deployments, you can also restrict by role or channel:

```bash
# Only allow users with specific roles (comma-separated role IDs)
tether config set ALLOWED_ROLES 111111111111111111,222222222222222222

# Only allow bot usage in specific channels (comma-separated channel IDs)
tether config set ALLOWED_CHANNELS 333333333333333333,444444444444444444
```

**How these work together:**
- If `ALLOWED_CHANNELS` is set, messages must be in an allowed channel (or its threads)
- If `ALLOWED_USERS` or `ALLOWED_ROLES` is set, the user must match at least one:
  - Be in the `ALLOWED_USERS` list, OR
  - Have a role in the `ALLOWED_ROLES` list
- Role and channel allowlists only apply in guilds (not DMs)
- If no allowlists are configured, the bot responds to everyone

**Examples:**

```bash
# Only respond to yourself
tether config set ALLOWED_USERS 123456789012345678

# Only respond in a specific channel
tether config set ALLOWED_CHANNELS 987654321098765432

# Only respond to admins (role ID)
tether config set ALLOWED_ROLES 555555555555555555

# Combine: only respond to specific users in specific channels
tether config set ALLOWED_USERS 123456789012345678
tether config set ALLOWED_CHANNELS 987654321098765432
```

#### Directory Allowlist

| Key | Default | Description |
|-----|---------|-------------|
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

#### Forum Sessions

By default, Tether creates threads in the channel where the bot is mentioned. When forum sessions are enabled, it creates forum posts in a dedicated forum channel instead — useful for keeping conversations organized and searchable.

```bash
tether config set FORUM_SESSIONS true
tether config set FORUM_CHANNEL_ID 123456789012345678
```

Both keys are required. See [Discord Setup — Forum Channels](discord-setup.md#6-use-forum-channels-optional) for the full setup guide.

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

See the [Security & Access Control](#security--access-control) section above for instructions on finding user, role, and channel IDs.
