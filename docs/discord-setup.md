# Discord Bot Setup

Step-by-step guide to creating and configuring your Discord bot for Tether.

## 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name (e.g. "Tether")
3. Note the **Application ID** — you'll need it for the invite link

## 2. Create the Bot User

1. In your application, go to the **Bot** tab in the left sidebar
2. Click **Add Bot** (if not already created)
3. Under **Token**, click **Reset Token** and copy it — this is your `DISCORD_BOT_TOKEN`
4. **Store this token securely** — you won't be able to see it again

Save the token to Tether's encrypted config:

```bash
tether config set DISCORD_BOT_TOKEN
# Paste token when prompted (input is hidden)
```

Or add it to your `.env` file:

```bash
DISCORD_BOT_TOKEN=your-token-here
```

## 3. Configure Privileged Intents

Under the **Bot** tab, toggle ON:

| Intent | Why |
|--------|-----|
| **Message Content Intent** | Required to read message text (not just metadata) |

> **Without Message Content Intent enabled, the bot will connect but never see message contents.** This is the #1 setup issue.

## 4. Bot Permissions

The bot needs these permissions in your server:

| Permission | Why |
|------------|-----|
| Send Messages | Reply to users |
| Create Public Threads | Create conversation threads |
| Send Messages in Threads | Respond in threads |
| Manage Threads | Rename threads with auto-generated names |
| Read Message History | Fetch channel context for new conversations |
| Add Reactions | 👀 acknowledgment reaction |
| Use Slash Commands | `/cord config` command |

**Permission integer:** `326417588288` (includes all of the above)

## 5. Generate the Invite Link

1. Go to the **OAuth2** tab → **URL Generator**
2. Under **Scopes**, select:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, select the permissions above — or paste `326417588288` as the permission integer
4. Copy the generated URL and open it in your browser
5. Select the server you want to add the bot to and click **Authorize**

## 6. Enable DMs (Optional)

If you want users to DM the bot directly:

1. Set `ENABLE_DMS=true`:
   ```bash
   tether config set ENABLE_DMS true
   ```
2. In the Developer Portal → **Bot** tab, make sure **Allow DMs** is not disabled

### DM Behavior

- Any message sent to the bot in DMs starts or continues a conversation
- No `@mention` needed — every DM is treated as a prompt
- Sessions persist per-user until manually reset
- Send `!reset` in DMs to start a fresh session
- Only `ALLOWED_USERS` is checked for DMs (roles and channels don't apply)

## 7. Start and Test

```bash
# Start Redis (if not already running)
redis-server
# or: brew services start redis

# Start Tether
tether start
```

You should see:

```
[bot] Connecting to Discord gateway (attempt 1)...
[bot] Logged in as YourBot#1234
[worker] Worker started, waiting for jobs...
```

In your Discord server, `@mention` the bot:

```
@Tether what time is it?
```

The bot will:
1. React with 👀
2. Create a thread with an auto-generated name
3. Post a "Processing..." status message
4. Forward the prompt to your AI agent
5. Post the response in the thread

## Finding Discord IDs

To get user, role, or channel IDs for [access control](configuration.md#security):

1. Enable **Developer Mode** in Discord: Settings → App Settings → Advanced → Developer Mode
2. Right-click a user, role, or channel → **Copy ID**
