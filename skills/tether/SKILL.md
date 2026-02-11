---
name: tether
description: Send messages, embeds, files, and interactive buttons to Discord via the Tether CLI. Multi-agent Discord bridge supporting Claude Code, OpenCode, and Codex.
triggers:
  - "send to discord"
  - "post to discord"
  - "discord message"
  - "notify discord"
  - "tether"
  - "brb"
---

# Tether - Discord Bridge Skill

Interact with Discord through Tether's CLI commands. This skill teaches AI agents how to send messages, embeds, files, and interactive buttons.

**GitHub:** https://github.com/thesammykins/tether

## What is Tether?

Tether is a Discord bot that bridges messages to AI coding agents (Claude Code, OpenCode, Codex). It supports:

- Multi-agent backend selection via `AGENT_TYPE` env var
- Access control (user/role/channel allowlists)
- Rate limiting and session management
- Thread-based conversations with auto-naming
- Pause/resume for conversation control

## Setup

Ensure Tether is running:
```bash
tether start
```

Verify it's connected:
```bash
curl -s http://localhost:2643/health
# {"status":"ok","connected":true,"user":"MyBot#1234"}
```

---

## CLI Commands

### send

Send a text message to a channel or thread.

```bash
tether send <channel> "message"
```

**Example:**
```bash
tether send 123456789 "Hello world!"
```

---

### embed

Send a formatted embed card with optional styling.

```bash
tether embed <channel> "description" [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--title "..."` | Embed title |
| `--url "..."` | Title link URL |
| `--color <name\|hex>` | red, green, blue, yellow, purple, orange, or 0xHEX |
| `--author "..."` | Author name |
| `--author-url "..."` | Author link |
| `--author-icon "..."` | Author icon URL |
| `--thumbnail "..."` | Small image (top right) |
| `--image "..."` | Large image (bottom) |
| `--footer "..."` | Footer text |
| `--footer-icon "..."` | Footer icon URL |
| `--timestamp` | Add current timestamp |
| `--field "Name:Value"` | Add field (append `:inline` for inline) |

**Examples:**

Simple embed:
```bash
tether embed 123456789 "Daily status update" --title "Status Report" --color green
```

Embed with fields:
```bash
tether embed 123456789 "Build completed successfully" \
  --title "CI/CD Pipeline" \
  --color green \
  --field "Branch:main:inline" \
  --field "Duration:2m 34s:inline" \
  --field "Tests:142 passed" \
  --footer "Deployed by Tether" \
  --timestamp
```

---

### file

Send a file attachment.

```bash
tether file <channel> <filepath> ["message"]
```

**Examples:**
```bash
tether file 123456789 ./report.md "Here's the weekly report"
tether file 123456789 ./logs.txt
```

---

### buttons

Send interactive buttons with optional handlers.

```bash
tether buttons <channel> "prompt" --button label="..." id="..." [options]
```

**Button options:**
| Option | Description |
|--------|-------------|
| `label="..."` | Button text (required) |
| `id="..."` | Custom ID for tracking (required) |
| `style="..."` | primary, secondary, success, danger |
| `reply="..."` | Ephemeral reply when clicked |
| `webhook="..."` | URL to POST click data to |

**Examples:**

Simple confirmation:
```bash
tether buttons 123456789 "Deploy to production?" \
  --button label="Deploy" id="deploy-prod" style="success" \
  --button label="Cancel" id="cancel-deploy" style="secondary"
```

With inline responses:
```bash
tether buttons 123456789 "Approve this PR?" \
  --button label="Approve" id="approve" style="success" reply="Approved! Merging now." \
  --button label="Reject" id="reject" style="danger" reply="Rejected. Please revise."
```

With webhook callback:
```bash
tether buttons 123456789 "Start backup?" \
  --button label="Start Backup" id="backup-start" style="primary" webhook="http://localhost:8080/backup"
```

---

### typing

Show typing indicator (useful before slow operations).

```bash
tether typing <channel>
```

---

### edit

Edit an existing message.

```bash
tether edit <channel> <messageId> "new content"
```

---

### delete

Delete a message.

```bash
tether delete <channel> <messageId>
```

---

### rename

Rename a thread.

```bash
tether rename <threadId> "new name"
```

---

### reply

Reply to a specific message (shows reply preview).

```bash
tether reply <channel> <messageId> "message"
```

---

### thread

Create a thread from a message.

```bash
tether thread <channel> <messageId> "thread name"
```

---

### react

Add a reaction to a message.

```bash
tether react <channel> <messageId> "emoji"
```

**Example:**
```bash
tether react 123456789 987654321 "👍"
```

---

### state

Update a message with a status indicator. Use this to show work progress on a thread starter or status message.

```bash
tether state <channel> <messageId> <state>
```

**Preset states:**
| State | Display |
|-------|---------|
| `processing` | 🤖 Processing... |
| `thinking` | 🧠 Thinking... |
| `searching` | 🔍 Searching... |
| `writing` | ✍️ Writing... |
| `done` | ✅ Done |
| `error` | ❌ Something went wrong |
| `waiting` | ⏳ Waiting for input... |

**Examples:**

Using presets:
```bash
tether state 123456789 987654321 processing
tether state 123456789 987654321 done
```

Custom status:
```bash
tether state 123456789 987654321 "🔄 Syncing database..."
```

---

## Choosing the Right Command

| Use Case | Command |
|----------|---------|
| Simple notification | `tether send` |
| Formatted status update | `tether embed` |
| Long content (logs, reports) | `tether file` |
| User needs to make a choice | `tether buttons` |
| Ask user a question (blocks until answer) | `tether ask` |
| Indicate processing (typing bubble) | `tether typing` |
| Update thread/message status | `tether state` |
| Update previous message | `tether edit` |
| Start a focused discussion | `tether thread` |
| Quick acknowledgment | `tether react` |

---

## Assembly Patterns

### Notification with follow-up options

```bash
# Send the notification
tether embed 123456789 "Build failed on main branch" \
  --title "CI Alert" \
  --color red \
  --field "Error:Test suite timeout" \
  --field "Commit:abc1234:inline"

# Offer actions
tether buttons 123456789 "What would you like to do?" \
  --button label="View Logs" id="view-logs" style="primary" reply="Fetching logs..." \
  --button label="Retry Build" id="retry" style="success" webhook="http://ci/retry" \
  --button label="Ignore" id="ignore" style="secondary" reply="Acknowledged"
```

### Progress updates

```bash
# Start with typing indicator
tether typing 123456789

# Send initial status message
MSGID=$(tether send 123456789 "🤖 Processing..." | grep -o '[0-9]*$')

# Update state as work progresses
tether state 123456789 $MSGID searching
tether state 123456789 $MSGID writing
tether state 123456789 $MSGID done
```

Or with custom progress:
```bash
tether state 123456789 $MSGID "🔄 Step 1/3: Fetching data..."
tether state 123456789 $MSGID "🔄 Step 2/3: Processing..."
tether state 123456789 $MSGID "🔄 Step 3/3: Generating report..."
tether state 123456789 $MSGID done
```

### Report delivery

```bash
# Send summary embed
tether embed 123456789 "Weekly metrics compiled" \
  --title "Weekly Report Ready" \
  --color blue \
  --field "Period:Jan 15-21:inline" \
  --field "Pages:12:inline"

# Attach the full report
tether file 123456789 ./weekly-report.pdf "Full report attached"
```

### Confirmation flow

```bash
# Ask for confirmation
tether buttons 123456789 "Delete all archived items older than 30 days?" \
  --button label="Yes, Delete" id="confirm-delete" style="danger" reply="Deleting..." \
  --button label="Cancel" id="cancel-delete" style="secondary" reply="Cancelled"
```

---

## Multi-Agent Features

Tether supports multiple AI agent backends via the `AGENT_TYPE` environment variable:

- **Claude Code** (`AGENT_TYPE=claude`) — Default, uses `claude` CLI
- **OpenCode** (`AGENT_TYPE=opencode`) — Uses `opencode` CLI
- **Codex** (`AGENT_TYPE=codex`) — Uses `codex` CLI

All agents use the same AgentAdapter interface, so switching is seamless.

---

## Session Management

Tether provides pause/resume control for conversations:

**Pause a thread:**
```
pause
```

**Resume a thread:**
```
resume
```

When paused, messages are held in a queue and processed when resumed.

---

## BRB Mode / Away Questions

When the user says **brb** (or "afk", "be right back", "stepping away") in a thread, Tether flags that session as "away." While away, the agent's prompt is augmented with instructions to use `tether ask` instead of built-in question tools.

When the user says **back** (or "im back", "i'm back", "here"), the flag is cleared and normal interaction resumes.

### How It Works

1. User types `brb` → bot replies with confirmation, flags thread as away
2. Agent receives system prompt guidance: "Use `tether ask` for questions"
3. Agent runs `tether ask` → Discord buttons appear in the thread
4. User clicks a button (or types a free-text answer) → agent gets the response via stdout
5. User types `back` → flag cleared, normal flow resumes

### ask

Ask the user a question with interactive buttons. Blocks until an answer is received.

```bash
tether ask <channelId> "question" --option "Option A" --option "Option B" [--timeout 300]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--option "..."` | Add a button option (repeatable, at least 1 required) |
| `--timeout <seconds>` | Timeout in seconds (default: 300 = 5 minutes) |

A "✏️ Type answer" button is always appended automatically, letting the user type a free-text response instead of picking from the options.

**Output:**
- On success: prints the selected option text to **stdout**, exits `0`
- On timeout: prints "No response received" to **stderr**, exits `1`
- For typed answers: prints whatever the user typed to **stdout**

**Examples:**

Simple yes/no:
```bash
tether ask 123456789 "Should I deploy to production?" --option "Yes" --option "No"
```

Multiple choice:
```bash
tether ask 123456789 "Which database migration strategy?" \
  --option "Rolling migration" \
  --option "Blue-green deploy" \
  --option "Skip for now"
```

With custom timeout (10 minutes):
```bash
tether ask 123456789 "Review this PR before I merge?" \
  --option "Approve" \
  --option "Request changes" \
  --timeout 600
```

---

## Auto-Complete Behavior

When a user adds a ✅ reaction to the **last message** in a thread, Tether automatically:
1. Detects the reaction
2. Updates the thread starter message to "✅ Done"

This provides a quick way for users to signal "conversation complete" without explicit commands.

---

## HTTP API

For advanced use cases (webhooks, external scripts), see [HTTP-API.md](./HTTP-API.md).
