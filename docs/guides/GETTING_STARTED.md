# 📖 Getting Started

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Getting%20Started-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Getting Started" />
</p>

Set up Sage from source — even if you’ve never built a Discord bot before.

<p align="center">
  <img src="https://img.shields.io/badge/Time-~20%20min-blue?style=flat-square" alt="Time" />
  <img src="https://img.shields.io/badge/Difficulty-Beginner-brightgreen?style=flat-square" alt="Difficulty" />
  <img src="https://img.shields.io/badge/Steps-7-orange?style=flat-square" alt="Steps" />
</p>

**Outcome:** A running self-hosted Sage instance, a working invite link, and a clear provider setup choice: host-level key now, server activation later, or both.

---

## 🧭 Quick navigation

- [✅ Before You Begin](#before-you-begin)
- [🗺️ Setup at a Glance](#setup-at-a-glance)
- [Step 1: Install Required Software](#step-1-install-required-software)
- [Step 2: Create Your Discord Bot](#step-2-create-your-discord-bot)
- [Step 3: Download and Configure Sage](#step-3-download-and-configure-sage)
- [Step 4: Start the Database](#step-4-start-the-database)
- [Step 5: Start Sage](#step-5-start-sage)
- [Step 6: Invite Sage to Your Server](#step-6-invite-sage-to-your-server)
- [Step 7: Activate Your API Key (BYOP)](#step-7-activate-your-api-key-byop)
- [✅ Verification Checklist](#verification-checklist)

---

<a id="before-you-begin"></a>

## ✅ Before You Begin

You’ll need:

- [ ] A **Discord account**
- [ ] A computer (Windows / macOS / Linux)
- [ ] Internet access

Everything else is installed in the steps below.

---

<a id="setup-at-a-glance"></a>

## 🗺️ Setup at a Glance

```mermaid
flowchart LR
    %% High-level setup checklist for self-hosting.
    classDef start fill:#dcedc8,stroke:#33691e,stroke-width:2px,color:black
    classDef step fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:black
    classDef endNode fill:#ffccbc,stroke:#bf360c,stroke-width:2px,color:black

    S1["1) Install prerequisites"]:::start
      --> S2["2) Create Discord app/bot"]:::step
      --> S3["3) Clone & install Sage"]:::step
      --> S4["4) Start PostgreSQL"]:::step
      --> S5["5) Configure .env"]:::step
      --> S6["6) Start Sage"]:::step
      --> S7["7) Invite bot & activate hosted key flow if needed"]:::endNode
```

---

<a id="step-1-install-required-software"></a>

## 1️⃣ Install Required Software

### 1.1 Install Node.js

Node.js runs Sage.

1. Go to <https://nodejs.org/en>
2. Install the **LTS** version
3. Restart your computer after installation

Verify:

```bash
node --version
```

You should see `v22.12.0` or newer (Sage requires Node.js `>=22.12.0`).

### 1.2 Install Docker Desktop

Docker runs the database Sage uses to store memory.

1. Go to <https://www.docker.com/products/docker-desktop/>
2. Install Docker Desktop for your OS
3. Start Docker Desktop (it must be running)

> 💡 **Don’t want Docker?** You can use an external PostgreSQL database instead. See [Alternative Database Setup](#alternative-database-without-docker).

### 1.3 Install Git (if you don’t have it)

Git downloads Sage’s code.

1. Go to <https://git-scm.com/downloads/>
2. Install for your OS using defaults

---

<a id="step-2-create-your-discord-bot"></a>

## 2️⃣ Create Your Discord Bot

### 2.1 Create a Discord Application

1. Open <https://discord.com/developers/applications>
2. Click **New Application**
3. Name it (e.g., “Sage”) and click **Create**

### 2.2 Get Your Application ID

1. In **General Information**, find **Application ID**
2. Click **Copy** — you’ll use it in `.env`

### 2.3 Create the Bot + Token

1. Click **Bot** in the sidebar
2. Click **Reset Token** (or **Add Bot** if it’s new)
3. Click **Copy** to copy the bot token

> ⚠️ **Never share your bot token.** Anyone with it can control your bot.

### 2.4 Enable Required Permissions (Gateway Intents)

On the Bot page, enable:

- ✅ **MESSAGE CONTENT INTENT**

Also ensure the bot has permissions to read/send messages in target channels, and voice permissions if using voice features.

Click **Save Changes**.

---

<a id="step-3-download-and-configure-sage"></a>

## 3️⃣ Download and Configure Sage

### 3.1 Download Sage

```bash
# Navigate to where you want to put Sage (e.g., Desktop)
cd Desktop

# Download Sage
git clone https://github.com/BokX1/Sage.git

# Enter the Sage folder
cd Sage
```

### 3.2 Install Dependencies

```bash
npm ci
```

### 3.3 Run the Onboarding Wizard

```bash
npm run onboard
```

The wizard will ask for:

| Prompt | What to Enter |
| :--- | :--- |
| **DISCORD_TOKEN** | Bot token from Step 2.3 |
| **DISCORD_APP_ID** | Application ID from Step 2.2 |
| **DATABASE_URL** | Choose **Use local Docker default** for local setup |
| **AI_PROVIDER_BASE_URL** | Required base URL for your OpenAI-compatible chat-completions endpoint |
| **AI provider setup mode** | Choose whether to set a host-level key now, rely on server activation later, or support both |
| **AI_PROVIDER_API_KEY** | Host-level provider key if you want Sage to have a default key outside the in-Discord server activation flow |
| **AI_PROVIDER_MAIN_AGENT_MODEL** | Required main runtime agent model id |
| **AI_PROVIDER_PROFILE_AGENT_MODEL** | Defaults to the main model unless you choose a separate profile model |
| **AI_PROVIDER_SUMMARY_AGENT_MODEL** | Defaults to the main model unless you choose a separate summary model |
| **AI_PROVIDER_MODEL_PROFILES_JSON** | Optional JSON object describing budgets/capabilities for configured agent models; use the live doctor/probe checks to confirm strict structured-output support for the main model |

> ✅ The wizard also ends with a grouped setup summary for Discord, database, AI provider configuration, and next steps.

**Non-interactive option (CI/automation):**

```bash
npm run onboard -- \
  --discord-token "YOUR_TOKEN" \
  --discord-app-id "YOUR_APP_ID" \
  --database-url "postgresql://..." \
  --api-key "YOUR_PROVIDER_KEY" \
  --model your-chat-model \
  --yes \
  --non-interactive \
  --start-docker \
  --migrate \
  --doctor
```

> ℹ️ `--api-key` seeds the optional host-level `AI_PROVIDER_API_KEY`. You can leave it blank and rely on Sage's in-Discord server-key flow instead.

---

<a id="step-4-start-the-database"></a>

## 4️⃣ Start the Database

Make sure Docker Desktop is running, then:

```bash
docker compose -f config/services/core/docker-compose.yml up -d db tika
```

Wait ~10 seconds, then run:

```bash
npx prisma migrate deploy
```

Optional: start the local tool stack (self-host search/scrape/infer):

```bash
docker compose -f config/services/self-host/docker-compose.tools.yml up -d
```

If using local tools first, set these `.env` values:

```env
TOOL_WEB_SEARCH_PROVIDER_ORDER=searxng,tavily,exa
TOOL_WEB_SCRAPE_PROVIDER_ORDER=crawl4ai,firecrawl,jina,nomnom,raw_fetch
SEARXNG_BASE_URL=http://127.0.0.1:18080
CRAWL4AI_BASE_URL=http://127.0.0.1:11235
```

For full details, see [operations/TOOL_STACK.md](../operations/TOOL_STACK.md).

---

<a id="step-5-start-sage"></a>

## 5️⃣ Start Sage

```bash
npm run dev
```

You should see:

```text
[info] Logged in as Sage#1234!
```

Keep this terminal window open.

---

<a id="step-6-invite-sage-to-your-server"></a>

## 6️⃣ Invite Sage to Your Server

### 6.1 Generate the Invite Link

1. Open <https://discord.com/developers/applications>
2. Select your application
3. Go to **OAuth2** → **URL Generator**

> [!TIP]
> `npm run onboard` prints the same recommended invite shape after setup using your configured `DISCORD_APP_ID`.

### 6.2 Select Scopes + Permissions

**Scopes:**

- ✅ `bot`

**Bot Permissions:**

| Permission | Integer | Purpose |
| :--- | :--- | :--- |
| Send Messages | 2048 | Reply to users |
| Read Message History | 65536 | Read conversation context |
| View Channels | 1024 | See channels |
| Embed Links | 16384 | Post embed-based onboarding and status messages |
| Connect | 1048576 | Voice awareness |

> 💡 **Permission Total:** 1133568 (sum of the permissions above)

### 6.3 Copy and Use the Link

1. Scroll down and copy the **Generated URL**
2. Open it in your browser
3. Select a server and click **Authorize**

---

<a id="step-7-activate-your-api-key-byop"></a>

## 7️⃣ Optional: Activate a Server Key (Pollinations BYOP)

Use this step if you want Sage's built-in server-wide activation flow. If you already configured `AI_PROVIDER_API_KEY` for your self-hosted runtime provider, you can skip it, but you do not have to set a host key anymore.

### 7.1 Trigger the setup card

1. Mention Sage or start a message with `Sage`
2. If the guild has no usable key, Sage posts the setup card for that server
3. Click `Get Pollinations Key` and sign in via Pollinations (GitHub)
4. Copy the `sk_...` key from the URL

> [!TIP]
> You can also manage/create keys from the Pollinations dashboard at `enter.pollinations.ai`.

### 7.2 Set the Server Key

1. Click `Set Server Key`
2. Paste `<your_key>` into the modal
3. Sage confirms the key is valid and shows account info

---

<a id="verification-checklist"></a>

## ✅ Verification Checklist

- [ ] Sage appears in your server member list
- [ ] Mention Sage or use the wake word — Sage should reply in-channel
- [ ] If you skipped `AI_PROVIDER_API_KEY`, trigger Sage once and confirm the setup card explains how to activate the server
- [ ] Chat with Sage in any of these ways:
  - **Wake word:** `Sage, hello!`
  - **Mention:** `@Sage what's up?`
  - **Reply:** reply to a Sage message
  - **Image generation:** `Sage, draw a small robot chef` (returns an image attachment)
  - **Image editing:** reply to an image: `Sage, make this more cinematic`

If Sage doesn’t respond:

1. Check terminal logs for errors
2. Run `npm run doctor`
3. See [Troubleshooting](TROUBLESHOOTING.md)

---

## 🎯 What’s Next?

### Talk to Sage

- “Sage, tell me about yourself?”
- “Sage, what’s the weather in Tokyo?”
- “Sage, summarize our conversation”
- “Sage, look at this image … and tell me what you see”
- “Sage, draw a watercolor mountain landscape”
- *(Reply to an image)* “Sage, turn this into a poster style”
- “Sage, look at this file …”

### Configure Behavior

Edit `.env` to customize:

- `WAKE_WORDS_CSV` — change what triggers Sage (default: `sage`)
- `AUTOPILOT_MODE` — set to `talkative` for unprompted responses

### Add Admin Access

Sage admin commands now use Discord-native permissions only.

1. Open **Server Settings** → **Roles**.
2. Ensure your role has **Manage Server** or **Administrator**.
3. Restart Sage only if you changed runtime configuration or deployment settings.

---

## 📚 Alternative Setups

### Alternative: Database Without Docker

If you don’t want Docker, use any PostgreSQL database:

1. Install PostgreSQL from <https://www.postgresql.org/download/>
2. Create a database called `sage`
3. During `npm run onboard`, choose **Paste DATABASE_URL manually**
4. Enter your connection string:

   `postgresql://username:password@localhost:5432/sage?schema=public`

### Alternative: Production Deployment

```bash
npm run build
npm start
```

Hosting options mentioned in this repo:

- <https://railway.com/>
- <https://render.com/>
- <https://www.digitalocean.com/>
- Your own VPS

---

## 🆘 Need Help?

- [FAQ](FAQ.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- `npm run doctor`
- GitHub issues: <https://github.com/BokX1/Sage/issues>
