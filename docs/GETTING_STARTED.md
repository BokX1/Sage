# 📖 Getting Started with Sage

Set up Sage from source — even if you’ve never built a Discord bot before.

**Time:** ~15–20 minutes  
**Outcome:** A running Sage instance + a working invite link + a configured Pollinations key (BYOP)

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

## ✅ Before You Begin

You’ll need:

- [ ] A **Discord account**
- [ ] A computer (Windows / macOS / Linux)
- [ ] Internet access

Everything else is installed in the steps below.

---

## 🗺️ Setup at a Glance

```mermaid
flowchart LR
    %% High-level setup checklist for self-hosting.
    classDef start fill:#dcedc8,stroke:#33691e,stroke-width:2px,color:black
    classDef step fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:black
    classDef endNode fill:#ffccbc,stroke:#bf360c,stroke-width:2px,color:black

    S1[1) Install prerequisites]:::start
      --> S2[2) Create Discord app/bot]:::step
      --> S3[3) Clone & install Sage]:::step
      --> S4[4) Start PostgreSQL]:::step
      --> S5[5) Configure .env]:::step
      --> S6[6) Start Sage]:::step
      --> S7[7) Invite bot & set key]:::endNode
```

---

## Step 1: Install Required Software

### 1.1 Install Node.js

Node.js runs Sage.

1. Go to https://nodejs.org/
2. Install the **LTS** version
3. Restart your computer after installation

Verify:

```bash
node --version
```

You should see something like `v20.11.0` (exact version may differ).

### 1.2 Install Docker Desktop

Docker runs the database Sage uses to store memory.

1. Go to https://www.docker.com/products/docker-desktop/
2. Install Docker Desktop for your OS
3. Start Docker Desktop (it must be running)

> 💡 **Don’t want Docker?** You can use an external PostgreSQL database instead. See [Alternative Database Setup](#alternative-database-without-docker).

### 1.3 Install Git (if you don’t have it)

Git downloads Sage’s code.

1. Go to https://git-scm.com/downloads
2. Install for your OS using defaults

---

## Step 2: Create Your Discord Bot

### 2.1 Create a Discord Application

1. Open https://discord.com/developers/applications
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

- ✅ **PRESENCE INTENT**
- ✅ **SERVER MEMBERS INTENT**
- ✅ **MESSAGE CONTENT INTENT**

Click **Save Changes**.

---

## Step 3: Download and Configure Sage

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
npm install
```

### 3.3 Run the Onboarding Wizard

```bash
npm run onboard
```

The wizard will ask for:

| Prompt | What to Enter |
|:-------|:--------------|
| **DISCORD_TOKEN** | Bot token from Step 2.3 |
| **DISCORD_APP_ID** | Application ID from Step 2.2 |
| **DATABASE_URL** | Type `2` to use the Docker default |
| **POLLINATIONS_API_KEY** | Optional global key (or set per server later via `/sage key set`) |
| **POLLINATIONS_MODEL** | Choose a default chat model |

> ✅ `npm run setup` is kept as a legacy alias for the onboarding wizard.

**Non-interactive option (CI/automation):**

```bash
npm run onboard --   --discord-token "YOUR_TOKEN"   --discord-app-id "YOUR_APP_ID"   --database-url "postgresql://..."   --api-key "YOUR_POLLINATIONS_KEY"   --model gemini   --yes   --non-interactive
```

> ℹ️ `--api-key` is optional. If you skip it, set a server key later with `/sage key set`.

---

## Step 4: Start the Database

Make sure Docker Desktop is running, then:

```bash
docker compose -f config/ci/docker-compose.yml up -d db
```

Wait ~10 seconds, then run:

```bash
npm run db:migrate
```

---

## Step 5: Start Sage

```bash
npm run dev
```

You should see:

```text
[info] Logged in as Sage#1234
[info] Ready!
```

Keep this terminal window open.

---

## Step 6: Invite Sage to Your Server

### 6.1 Generate the Invite Link

1. Open https://discord.com/developers/applications
2. Select your application
3. Go to **OAuth2** → **URL Generator**

### 6.2 Select Scopes + Permissions

**Scopes:**

- ✅ `bot`
- ✅ `applications.commands`

**Bot Permissions:**

| Permission | Integer | Purpose |
|:-----------|:--------|:--------|
| Send Messages | 2048 | Reply to users |
| Read Message History | 65536 | Read conversation context |
| View Channels | 1024 | See channels |
| Connect | 1048576 | Voice awareness |

> 💡 **Permission Total:** 1117184 (sum of the permissions above)

### 6.3 Copy and Use the Link

1. Scroll down and copy the **Generated URL**
2. Open it in your browser
3. Select a server and click **Authorize**

---

## Step 7: Activate Your API Key (BYOP)

Once Sage is in your server, set up your Pollinations API key:

### 7.1 Get Your API Key

1. Run `/sage key login` in any channel
2. Click the link to log in at Pollinations
3. Copy the `sk_...` key from the URL

### 7.2 Set the Server Key

1. Run `/sage key set <your_key>`
2. Sage will confirm the key is valid and show your account info

> 💡 **Need a key?** The `/sage key login` command provides step-by-step instructions.

---

## ✅ Verification Checklist

- [ ] Sage appears in your server member list
- [ ] Run `/ping` — Sage should reply with **Pong!**
- [ ] Chat with Sage in any of these ways:
  - **Wake word:** `Sage, hello!`
  - **Mention:** `@Sage what's up?`
  - **Reply:** reply to a Sage message

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
- “Sage, look at this file …”

### Configure Behavior

Edit `.env` to customize:

- `WAKE_WORDS` — change what triggers Sage (default: `sage`)
- `AUTOPILOT_MODE` — set to `talkative` for unprompted responses
- `ADMIN_USER_IDS` — enable admin commands for your Discord user

### Add Admin Access

1. Enable Developer Mode in Discord → right-click yourself → **Copy ID**
2. In `.env`, set: `ADMIN_USER_IDS=your_id_here`
3. Restart Sage

---

## 📚 Alternative Setups

### Alternative: Database Without Docker

If you don’t want Docker, use any PostgreSQL database:

1. Install PostgreSQL from https://www.postgresql.org/download/
2. Create a database called `sage`
3. During `npm run onboard` (or `npm run setup`), choose option `1` for DATABASE_URL
4. Enter your connection string:

   `postgresql://username:password@localhost:5432/sage?schema=public`

### Alternative: Production Deployment

```bash
npm run build
npm start
```

Hosting options mentioned in this repo:

- https://railway.app
- https://render.com
- https://digitalocean.com
- Your own VPS

---

## 🆘 Need Help?

- [FAQ](FAQ.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- `npm run doctor`
- GitHub issues: https://github.com/BokX1/Sage/issues