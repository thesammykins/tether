# Agent Setup

Tether bridges Discord messages to an AI coding agent CLI. You need at least one agent installed and available on your system PATH.

Set the agent type in your config:

```bash
tether config set AGENT_TYPE claude    # or: opencode, codex
```

## Claude Code

Claude Code is Anthropic's agentic coding tool. It runs natively — no Node.js required.

### Install

**Quick install (macOS/Linux):**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Homebrew (macOS):**

```bash
brew install --cask claude-code
```

### Authenticate

```bash
claude
# Follow prompts to log in with your Anthropic account
```

You need an active Anthropic account. Claude Code authenticates via browser — no API key needed for interactive use.

### Verify

```bash
claude --version
claude --print -p "say hello"
```

### How Tether Uses It

Tether spawns Claude Code with:

```bash
claude --print --output-format json --session-id <id> -p "<prompt>"
# Follow-ups:
claude --print --output-format json --resume <id> -p "<prompt>"
```

If the `claude` binary is not on PATH (common for service/daemon installs),
set an explicit path override:

```bash
tether config set CLAUDE_BIN /full/path/to/claude
```

Key flags:
- `--print` — Non-interactive mode, returns output to stdout
- `--session-id` / `--resume` — Session persistence across messages in the same thread
- `--append-system-prompt` — Injects datetime context and channel info
- `--output-format json` — Structured output for reliable parsing

---

## OpenCode

OpenCode supports multiple AI providers (OpenAI, Anthropic, Google, etc.).

### Install

**Quick install:**

```bash
curl -fsSL https://opencode.ai/install | bash
```

**npm:**

```bash
npm install -g opencode
```

### Configure

OpenCode reads its config from `~/.config/opencode/`. You'll need an API key for your chosen provider:

```bash
# Set your provider API key (e.g. for Anthropic)
export ANTHROPIC_API_KEY=sk-ant-...

# Or for OpenAI
export OPENAI_API_KEY=sk-...
```

See the [OpenCode docs](https://opencode.ai/docs) for full provider configuration.

### Verify

```bash
opencode --version
opencode run "say hello"
```

### How Tether Uses It

Tether spawns OpenCode with:

```bash
opencode run --format json "<prompt>"
# Follow-ups:
opencode run --format json --session <id> "<prompt>"
```

If the `opencode` binary is not on PATH (common for service/daemon installs),
set an explicit path override:

```bash
tether config set OPENCODE_BIN /full/path/to/opencode
```

Key flags:
- `run` — Execute a prompt
- `--format json` — Structured output
- `--session <id>` — Resume an existing session
- `--cwd <path>` — Set working directory

---

## Codex

Codex is OpenAI's CLI coding agent. Requires Node.js 22+.

### Install

```bash
npm install -g @openai/codex
```

### Configure

Codex requires an OpenAI API key:

```bash
export OPENAI_API_KEY=sk-...
```

### Verify

```bash
codex --version
codex exec "say hello"
```

### How Tether Uses It

Tether spawns Codex with:

```bash
codex exec --json "<prompt>"
# Follow-ups:
codex exec resume <sessionId> --json "<prompt>"
```

If the `codex` binary is not on PATH (common for service/daemon installs),
set an explicit path override:

```bash
tether config set CODEX_BIN /full/path/to/codex
```

Key flags:
- `exec` — Execute a prompt
- `--json` — Structured output
- `resume <id>` — Resume an existing session

---

## Having the Agent Set Up Tether

If you're already running one of these agents in a project, you can ask it to install and configure Tether:

### Claude Code

```
Install @thesammykins/tether globally with bun. Configure it with my Discord
bot token (I'll provide it when prompted), set the agent type to claude, and
set my allowed channel to 123456789. Then start the bot.
```

### OpenCode

```
Run these commands to set up Tether:
1. bun add -g @thesammykins/tether
2. tether config set DISCORD_BOT_TOKEN (I'll provide the token)
3. tether config set AGENT_TYPE opencode
4. tether config set ALLOWED_CHANNELS 123456789
5. tether start
```

### Codex

```
Install @thesammykins/tether with: bun add -g @thesammykins/tether
Then configure it: tether config set AGENT_TYPE codex
Set the channel: tether config set ALLOWED_CHANNELS 123456789
I'll set the bot token manually.
```

> **Note:** The bot token is a secret — you'll always need to provide it interactively via `tether config set DISCORD_BOT_TOKEN` (input is hidden). Don't paste tokens into agent prompts.

## Switching Agents

Change agents at any time:

```bash
tether config set AGENT_TYPE opencode
tether stop && tether start
```

Existing thread sessions will not carry over — new messages start fresh sessions with the new agent.
