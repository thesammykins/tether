# Contributing to Tether

Thank you for your interest in contributing. To keep this project maintainable and high quality, all contributions **must** follow the rules below. No exceptions.

## The Rules

### 1. Every PR Must Have a Linked Issue

**PRs without a linked issue will be automatically closed.**

Before writing any code, open an issue describing what you want to change and why. Get confirmation the change is wanted before investing time. Link the issue in your PR body using [closing keywords](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue):

```
Closes #42
Fixes #17
Resolves #99
```

### 2. AI Usage Must Be Disclosed

If any part of your contribution was written, generated, or assisted by AI (Copilot, Claude, ChatGPT, Cursor, etc.), you **must** include a full transcript of the AI session in the PR description or as an attached file.

This means:

- The complete conversation/session log, not a summary
- Which tool was used (model name, IDE integration, etc.)
- What prompts were given and what output was produced

**Why:** Reviewers need to understand the provenance of code. AI-generated code that hasn't been critically reviewed is a liability.

### 3. End-to-End Testing is Mandatory

Every PR must include evidence of **full e2e testing**. This is not optional.

- Run the full test suite (`bun test`) and include the output
- Run the full e2e suite and include the output:
  - `ENABLE_E2E_TESTS=true DISCORD_BOT_TOKEN=... bun test tests/e2e/discord.test.ts`
  - Redis must be running and you must have access to the configured test channel
- If your change affects bot behaviour, demonstrate it working against a live Discord server or a mock environment
- If your change affects CLI commands, show terminal output of the command working
- New features require new tests. Bug fixes require regression tests.

### 4. Screenshots Are Required

Include screenshots or screen recordings that prove your change does what the linked issue asked for **and** why the PR exists.

- **UI/Discord changes:** Screenshots of the bot's messages, embeds, buttons, etc.
- **CLI changes:** Terminal screenshots showing the command and its output
- **API changes:** Screenshots of request/response (curl, Postman, etc.)
- **Internal refactors:** Screenshot of the test suite passing is sufficient

Screenshots must clearly demonstrate the before/after or the new behaviour and tie it back to the linked issue.

## PR Checklist

Every PR description must include this completed checklist. The PR template fills this in automatically.

- [ ] Linked issue (e.g., `Closes #123`)
- [ ] AI transcript attached (if AI was used)
- [ ] Full test suite passes (`bun test` output included)
- [ ] Full e2e test suite passes (e2e output included)
- [ ] Screenshots proving the change works as intended
- [ ] New/changed behaviour has corresponding tests

## Setting Up Locally

```bash
# Clone and install
git clone https://github.com/thesammykins/tether.git
cd tether
bun install

# Run tests
bun test

# Start the bot (requires Discord token + Redis)
bun start
```

See the [docs/](docs/) folder for detailed setup guides.

## Commit Messages

Write clear commit messages. Describe what changed and why, not how.

```
Good: "fix: prevent duplicate thread creation on rapid mentions"
Bad:  "fixed stuff"
Bad:  "update bot.ts"
```

## Code Style

- Match existing patterns in the codebase
- No `any` types
- No commented-out code
- Comments explain *why*, not *what*

## Questions?

Open an issue. Don't DM maintainers.
