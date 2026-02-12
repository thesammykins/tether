# CLI Reference

Full reference for the `tether` command-line interface.

```bash
tether <command> [options]
```

## Management Commands

### `tether start`

Start the Discord bot and job worker as child processes.

```bash
tether start
```

| Option | Description |
|--------|-------------|
| `--debug` | Enable verbose debug logging for binary resolution, spawn args, env state, and worker pipeline |
| `--verbose` | Alias for `--debug` |

Debug mode prints a startup summary (agent type, resolved scripts, working directory, Redis, API bind, PATH) and sets `TETHER_DEBUG=true` for the bot and worker child processes. Adapter binary resolution, spawn diagnostics, and worker job processing all emit detailed debug output.

Blocks the terminal — both bot and worker run until you stop them. To run in the background:

```bash
nohup bun run bin/tether.ts start --debug > /tmp/tether.log 2>&1 &
```

### `tether stop`

Stop all running Tether processes.

```bash
tether stop
```

### `tether status`

Show whether the bot and worker are running.

```bash
tether status
```

### `tether health`

Check Discord gateway connection status.

```bash
tether health
```

### `tether setup`

Interactive setup wizard — walks you through token, agent type, and channel configuration.

```bash
tether setup
```

### `tether help`

Show the built-in help text.

```bash
tether help
```

---

## Discord Commands

### `tether send`

Send a text message to a channel.

```bash
tether send <channel-id> "message"
```

### `tether embed`

Send a rich embed.

```bash
tether embed <channel-id> "description" [options]
```

| Option | Description |
|--------|-------------|
| `--title "..."` | Embed title |
| `--url "..."` | Title link URL |
| `--color <name\|hex>` | `red`, `green`, `blue`, `yellow`, `purple`, `orange`, or `0xHEX` |
| `--author "..."` | Author name |
| `--author-url "..."` | Author link |
| `--author-icon "..."` | Author icon URL |
| `--thumbnail "..."` | Small image (top right) |
| `--image "..."` | Large image (bottom) |
| `--footer "..."` | Footer text |
| `--footer-icon "..."` | Footer icon URL |
| `--timestamp` | Add current timestamp |
| `--field "Name:Value"` | Add a field (append `:inline` for inline) |

**Example:**

```bash
tether embed 123456789 "Status update" \
  --title "Daily Report" \
  --color green \
  --field "Tasks:5 done:inline"
```

### `tether file`

Send a file attachment.

```bash
tether file <channel-id> <filepath> ["message"]
```

### `tether buttons`

Send interactive buttons.

```bash
tether buttons <channel-id> "prompt" --button label="..." id="..." [options]
```

Each `--button` takes these key-value pairs:

| Key | Required | Description |
|-----|----------|-------------|
| `label="..."` | Yes | Button text |
| `id="..."` | Yes | Custom ID for identifying clicks |
| `style="..."` | No | `primary`, `secondary`, `success`, `danger` |
| `reply="..."` | No | Ephemeral reply when clicked |
| `webhook="..."` | No | URL to POST click data to |

**Example:**

```bash
tether buttons 123456789 "Approve this PR?" \
  --button label="Yes" id="approve" style="success" reply="Approved!" \
  --button label="No" id="reject" style="danger" reply="Rejected"
```

### `tether ask`

Ask a blocking question with button options. Blocks until someone answers or the timeout expires. Prints the selected answer to stdout.

```bash
tether ask <channel-id> "question" --option "A" --option "B" [--timeout 300]
```

- Exit code `0` on answer, `1` on timeout
- Automatically includes a **"Type answer"** button for free-form text input
- Default timeout: 300 seconds (5 minutes)

**Example:**

```bash
ANSWER=$(tether ask 123456789 "Deploy to prod?" --option "Yes" --option "No" --timeout 600)
if [ "$ANSWER" = "Yes" ]; then
  deploy_to_prod
fi
```

### `tether typing`

Show the typing indicator in a channel.

```bash
tether typing <channel-id>
```

### `tether edit`

Edit an existing message.

```bash
tether edit <channel-id> <message-id> "new content"
```

### `tether delete`

Delete a message.

```bash
tether delete <channel-id> <message-id>
```

### `tether rename`

Rename a thread.

```bash
tether rename <thread-id> "new name"
```

### `tether reply`

Reply to a specific message.

```bash
tether reply <channel-id> <message-id> "reply text"
```

### `tether thread`

Create a thread from a message.

```bash
tether thread <channel-id> <message-id> "thread name"
```

### `tether react`

Add a reaction to a message.

```bash
tether react <channel-id> <message-id> "emoji"
```

### `tether state`

Update a thread status message with a preset or custom text.

```bash
tether state <channel-id> <message-id> <state>
```

**Presets:** `processing`, `thinking`, `searching`, `writing`, `done`, `error`, `waiting`

---

## DM Commands

Proactive outreach — send messages directly to a user.

### `tether dm` (text)

```bash
tether dm <user-id> "message"
```

### `tether dm --embed`

Send a rich embed via DM (same options as `tether embed`).

```bash
tether dm <user-id> --embed "description" --title "Title" --color green
```

### `tether dm --file`

Send a file attachment via DM.

```bash
tether dm <user-id> --file ./report.md "Here's the report"
```

---

## Config Commands

Manage persistent configuration and encrypted secrets. See [Configuration](configuration.md) for details.

```bash
tether config set <key> [value]     # Set a value (prompts for secrets)
tether config get <key>             # Get resolved value with source
tether config list                  # Show all values with sources
tether config delete <key>          # Remove a value
tether config import [path]         # Import from .env file (default: ./.env)
tether config path                  # Show config file locations
```

---

## HTTP API

Tether exposes an HTTP API on port 2643 for external scripts and webhooks. See the [API documentation](../skills/tether/HTTP-API.md).
