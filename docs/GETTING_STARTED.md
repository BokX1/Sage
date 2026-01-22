# Getting Started with Sage

Welcome! This guide will walk you through setting up Sage from scratch, even if you've never worked with Discord bots before.

**Time required:** About 15-20 minutes

---

## 📋 Before You Begin

Make sure you have:

- [ ] A **Discord account** (you probably have this!)
- [ ] A **computer** running Windows, Mac, or Linux
- [ ] An **internet connection**

That's it! We'll install everything else together.

---

## Step 1: Install Required Software

### 1.1 Install Node.js

Node.js is the platform that runs Sage.

1. Go to [nodejs.org](https://nodejs.org/)
2. Click the **LTS** (Long Term Support) version — it's the big green button
3. Run the installer and click "Next" through the prompts
4. **Restart your computer** after installation

**Verify it worked:**
Open a terminal (Command Prompt on Windows, Terminal on Mac) and type:

```bash
node --version
```

You should see something like `v20.11.0` (the number may vary).

### 1.2 Install Docker Desktop

Docker runs the database that Sage uses to remember things.

1. Go to [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. Download for your operating system
3. Run the installer
4. **Start Docker Desktop** after installation (it needs to be running)

> 💡 **Don't want Docker?** You can use an external PostgreSQL database instead. See [Alternative Database Setup](#alternative-database-without-docker).

### 1.3 Install Git (if you don't have it)

Git lets you download Sage's code.

1. Go to [git-scm.com/downloads](https://git-scm.com/downloads)
2. Download for your operating system
3. Run the installer with default settings

---

## Step 2: Create Your Discord Bot

### 2.1 Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **"New Application"** (top right)
3. Enter a name (e.g., "Sage") and click **Create**
4. You're now on your application's page!

### 2.2 Get Your Application ID

1. On the **General Information** page
2. Find **"Application ID"**
3. Click **"Copy"** — save this somewhere, you'll need it later

### 2.3 Create the Bot

1. Click **"Bot"** in the left sidebar
2. Click **"Reset Token"** (or "Add Bot" if it's new)
3. Click **"Copy"** to copy your bot token
4. **Save this token somewhere safe** — you can only see it once!

> ⚠️ **Never share your bot token!** Anyone with it can control your bot.

### 2.4 Enable Required Permissions

Still on the Bot page:

1. Scroll down to **"Privileged Gateway Intents"**
2. Enable these three options:
   - ✅ **PRESENCE INTENT**
   - ✅ **SERVER MEMBERS INTENT**
   - ✅ **MESSAGE CONTENT INTENT**
3. Click **"Save Changes"**

---

## Step 3: Download and Configure Sage

### 3.1 Download Sage

Open a terminal and run:

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

This downloads all the packages Sage needs. It might take a minute.

### 3.3 Run the Onboarding Wizard

```bash
npm run onboard
```

The wizard will ask you for:

| Prompt | What to Enter |
|:-------|:--------------|
| **DISCORD_TOKEN** | Paste the bot token from Step 2.3 |
| **DISCORD_APP_ID** | Paste the Application ID from Step 2.2 |
| **DATABASE_URL** | Type `2` to use the Docker default |
| **POLLINATIONS_API_KEY** | Required — get one at [pollinations.ai](https://pollinations.ai/) |
| **POLLINATIONS_MODEL** | Choose a default chat model from the list |

> ✅ `npm run setup` is kept as a legacy alias for the onboarding wizard.

**Non-interactive option (CI/automation):**

```bash
npm run onboard -- \
  --discord-token "YOUR_TOKEN" \
  --discord-app-id "YOUR_APP_ID" \
  --database-url "postgresql://..." \
  --api-key "YOUR_POLLINATIONS_KEY" \
  --model gemini \
  --yes \
  --non-interactive
```

---

## Step 4: Start the Database

Make sure Docker Desktop is running, then:

```bash
docker compose up -d db
```

**What this does:** Starts a PostgreSQL database in the background.

Wait about 10 seconds for it to fully start, then:

```bash
npm run db:migrate
```

**What this does:** Sets up the database tables Sage needs.

---

## Step 5: Start Sage

```bash
npm run dev
```

**You should see:**

```
[info] Logged in as Sage#1234
[info] Ready!
```

🎉 **Sage is now running!** Keep this terminal window open.

---

## Step 6: Invite Sage to Your Server

### 6.1 Generate the Invite Link

1. Go back to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application
3. Click **"OAuth2"** in the left sidebar
4. Click **"URL Generator"**

### 6.2 Select Permissions

**Scopes:** Check these boxes:

- ✅ `bot`
- ✅ `applications.commands`

**Bot Permissions:** Check these boxes:

- ✅ Send Messages
- ✅ Read Message History
- ✅ View Channels
- ✅ Connect (for voice awareness)

### 6.3 Copy and Use the Link

1. Scroll down and copy the **Generated URL**
2. Paste it in your browser
3. Select your server and click **Authorize**

---

## ✅ Verification Checklist

Make sure everything is working:

- [ ] Sage appears in your server's member list (might show as offline for a moment)
- [ ] Type `/ping` — Sage should respond with "Pong!"
- [ ] Type "Sage, how are you?" — Sage should reply

**If Sage doesn't respond:**

1. Check the terminal for error messages
2. Run `npm run doctor` to diagnose issues
3. See [Troubleshooting](../README.md#-troubleshooting)

---

## 🎯 What's Next?

Now that Sage is running, try these:

### Talk to Sage

- "Sage, tell me about yourself"
- "Sage, what's the weather in Tokyo?"
- "Sage, summarize our conversation"

### Configure Behavior

Edit `.env` to customize:

- `WAKE_WORDS` — Change what triggers Sage (default: "sage")
- `AUTOPILOT_MODE` — Set to "talkative" for unprompted responses
- `ADMIN_USER_IDS` — Add your Discord ID for admin commands

### Add Admin Access

1. Get your Discord User ID (Enable Developer Mode → Right-click yourself → Copy ID)
2. Open `.env` and add: `ADMIN_USER_IDS=your_id_here`
3. Restart Sage

---

## 📚 Alternative Setups

### Alternative: Database Without Docker

If you don't want to use Docker, you can use any PostgreSQL database:

1. Install PostgreSQL from [postgresql.org](https://www.postgresql.org/download/)
2. Create a database called `sage`
3. During `npm run onboard` (or `npm run setup`), choose option `1` for DATABASE_URL
4. Enter your connection string: `postgresql://username:password@localhost:5432/sage?schema=public`

### Alternative: Production Deployment

For 24/7 hosting, build for production:

```bash
npm run build
npm start
```

Consider hosting on:

- [Railway](https://railway.app)
- [Render](https://render.com)
- [DigitalOcean](https://digitalocean.com)
- Your own VPS

---

## 🆘 Need Help?

- Check the [FAQ](FAQ.md) for common questions
- See the [Troubleshooting Guide](../README.md#-troubleshooting)
- Run `npm run doctor` for diagnostics
- Open an issue on [GitHub](https://github.com/BokX1/Sage/issues)
