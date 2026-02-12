---
name: Pull Request
about: Submit a change to the project
---

## Linked Issue

<!-- REQUIRED: Every PR must reference an existing issue. PRs without a linked issue are automatically closed. -->

Closes #

## What Changed

<!-- Brief description of the change and why it's needed. -->

## AI Disclosure

<!-- REQUIRED if AI was used. Delete this section ONLY if no AI tools were involved. -->

**AI tool used:** <!-- e.g., Claude Code, GitHub Copilot, Cursor, ChatGPT -->

<details>
<summary>Full AI transcript</summary>

<!-- Paste the complete AI session transcript here. Not a summary — the full log. -->

```
PASTE TRANSCRIPT HERE
```

</details>

## E2E Test Results

<!-- REQUIRED: Paste the full output of `bun test` and the full e2e test output below. -->

<details>
<summary>Test output</summary>

```
PASTE bun test OUTPUT HERE
```

</details>

<details>
<summary>E2E test output</summary>

```
PASTE ENABLE_E2E_TESTS=true DISCORD_BOT_TOKEN=... bun test tests/e2e/discord.test.ts OUTPUT HERE
```

</details>

## Screenshots

<!-- REQUIRED: Screenshots proving the change works as intended and why this PR was raised. -->

| Before | After |
|--------|-------|
| screenshot | screenshot |

## Checklist

- [ ] Linked to an existing issue (e.g., `Closes #123`)
- [ ] AI transcript included (if AI was used)
- [ ] Full `bun test` output included and passing
- [ ] Screenshots attached proving the change works
- [ ] New/changed behaviour has corresponding tests
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md)
