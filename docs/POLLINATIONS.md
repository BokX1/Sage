# 🐝 Pollinations.ai Integration

Sage runs on **Pollinations.ai** for **text**, **vision**, **voice (TTS)**, and **image generation**.

This document is written for:

- **Users** (how to use Sage in Discord)
- **Server admins** (how BYOP keys work)
- **Self-hosters** (which `.env` settings matter)
- **Reviewers** (what Sage calls upstream, and how to verify it)

> [!IMPORTANT]
> Pollinations has gone through an auth migration: **token/key management moved to `enter.pollinations.ai`** and the old `auth.pollinations.ai` service is deprecated.

---

## 🧭 Quick navigation

- [✅ What Sage uses Pollinations for](#-what-sage-uses-pollinations-for)
- [🔗 Hosts and endpoints (the “unified” surface)](#-hosts-and-endpoints-the-unified-surface)
- [🌸 BYOP: server-wide keys in Discord](#-byop-server-wide-keys-in-discord)
- [⚙️ Self-host configuration (`.env`)](#-self-host-configuration-env)
- [🧠 Text + vision (OpenAI-compatible chat)](#-text--vision-openai-compatible-chat)
- [🎨 Image generation + image editing](#-image-generation--image-editing)
- [🔊 Voice (TTS) via Pollinations](#-voice-tts-via-pollinations)
- [✅ Verify Pollinations upstream (smoke tests)](#-verify-pollinations-upstream-smoke-tests)
- [🧩 Applying to be featured on pollinations.ai/apps](#-applying-to-be-featured-on-pollinationsaiapps)
- [🧯 Troubleshooting](#-troubleshooting)
- [🔗 Resources](#-resources)

---

## ✅ What Sage uses Pollinations for

| Capability | What users see in Discord | What Sage calls upstream |
|---|---|---|
| **Chat** | Normal conversations | OpenAI-compatible `chat/completions` on `gen.pollinations.ai` |
| **Vision** | You send an image, Sage can describe/analyze it | `chat/completions` with `image_url` content parts |
| **Image generation** | “Sage, draw …” → image attachment | `GET /image/{prompt}` on `gen.pollinations.ai` |
| **Image editing** | Reply to an image: “make it watercolor” → edited image | Same image endpoint + `image=<url>` parameter |
| **Voice (TTS)** | Sage speaks in a voice channel (when enabled) | `chat/completions` with model `openai-audio` |

Pollinations positions itself as a **unified API** for multiple modalities (text/images/audio, etc.).

---

## 🔗 Hosts and endpoints (the “unified” surface)

Sage uses these Pollinations hosts:

- **Dashboard + accounts + keys**: `https://enter.pollinations.ai` (manage keys, usage, account)
- **OpenAI-compatible API base**: `https://gen.pollinations.ai/v1`
- **Image bytes endpoint**: `https://gen.pollinations.ai/image/{prompt}`

> [!NOTE]
> You may still find older docs or examples using different hosts/subdomains. Sage’s current integration assumes the **enter + gen** split above, and the deprecated auth host should not be used.

---

## 🌸 BYOP: server-wide keys in Discord

Sage supports **Bring Your Own Pollen (BYOP)**: a **server admin** sets a Pollinations **Secret key** once, and Sage uses it for that server.

### Key types (what to paste)

- Use **Secret keys** that start with `sk_...`
- Do **not** paste keys in public channels. Use Sage’s **ephemeral** command replies.

### How `/sage key login` works

1. Run: `/sage key login`
2. Sage gives an auth link to Pollinations:
   - `https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage`
3. After you sign in, Pollinations redirects you to a URL containing:
   - `https://pollinations.ai/#api_key=sk_...`
4. Copy the `sk_...` part and run:
   - `/sage key set <sk_...>`

### How Sage validates your key

Before storing, Sage verifies the key by calling:

- `GET https://gen.pollinations.ai/account/profile` with header `Authorization: Bearer sk_...`

If that succeeds, Sage stores the key **scoped to the current Discord server**.

### Key precedence (what Sage actually uses)

When Sage needs a key, it resolves in this order:

1. **Server key** (set via `/sage key set`)
2. **Host-level fallback** (`LLM_API_KEY` in `.env`)
3. If neither exists, Sage may run on a **shared quota** (feature-dependent)

> [!IMPORTANT]
> **Voice (TTS)** requires a key (server key or `LLM_API_KEY`) because Sage uses `openai-audio` for TTS.

---

## ⚙️ Self-host configuration (`.env`)

Minimum Pollinations settings (see `.env.example` for the full list):

```env
LLM_PROVIDER=pollinations
LLM_BASE_URL=https://gen.pollinations.ai/v1
CHAT_MODEL=kimi

# Optional: Global fallback key (used if no BYOP key is set for the server)
LLM_API_KEY=
```

### Recommended: keep `LLM_BASE_URL` at the `/v1` root

Sage will append `/chat/completions` internally. If you accidentally include `/chat/completions` in the base URL, Sage normalizes it, but keeping it clean avoids confusion.

### Common model overrides (optional)

These are **defaults** you can customize:

```env
# Main chat model (routes: chat, coding, manage)
CHAT_MODEL=kimi

# Profile/memory updates (route: analyze)
PROFILE_CHAT_MODEL=deepseek

# Channel summaries (route: analyze)
SUMMARY_MODEL=openai-large

# Structured JSON formatting
FORMATTER_MODEL=qwen-coder
```

> [!NOTE]
> Image generation uses a Pollinations image model (currently set in code). See the Image section below for details.

---

## 🧠 Text + vision (OpenAI-compatible chat)

Sage uses Pollinations via the OpenAI-compatible endpoint:

- `POST https://gen.pollinations.ai/v1/chat/completions`

### Vision message shape (conceptual)

When users attach an image, Sage can send multimodal content:

```json
{
  "model": "kimi",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe this image." },
        { "type": "image_url", "image_url": { "url": "https://..." } }
      ]
    }
  ]
}
```

> [!TIP]
> If you’re self-hosting and debugging, test with the official API docs for the current request schema.

---

## 🎨 Image generation + image editing

Sage can:

- **Generate** images from a text prompt
- **Edit** images when the user replies to an image (image-to-image)

### What users do in Discord

No slash command is required.

**Generate**

- `Sage, draw a neon cyberpunk street scene at night`

**Edit**

- Reply to an image and say:
  - `Sage, make this look like a watercolor poster`

### What Sage calls upstream

Sage fetches raw image bytes from Pollinations:

- `GET https://gen.pollinations.ai/image/{prompt}`

Sage appends query parameters:

- `model` (default in code: `klein-large`)
- `seed` (random per request)
- `nologo=true`
- `key=sk_...` (only when BYOP/global key is available)

When editing, Sage also includes:

- `image=<url>` (the source image URL)

> [!NOTE]
> Pollinations supports additional image parameters (e.g., sizes) in some setups and clients, but Sage documents only what it currently uses by default.

### “Agentic” prompt refinement (why results look better)

Before requesting the image, Sage runs a **prompt refiner**:

- Uses an LLM to rewrite the user’s request into an image-optimized prompt
- Pulls in **recent conversation context** (last ~10 messages)
- Includes reply context and the input image (when editing)

This is why “make it more cyberpunk” works even without restating the full prompt.

---

## 🔊 Voice (TTS) via Pollinations

Sage can speak in Discord voice channels when voice features are enabled.

- TTS is generated via the OpenAI-compatible chat endpoint using model **`openai-audio`**
- **A Pollinations key is required** (server BYOP key or `LLM_API_KEY`), otherwise TTS is skipped

Operationally:

- The bot joins a voice channel (`/join`)
- Sage generates audio bytes via Pollinations and plays them in-channel

---

## ✅ Verify Pollinations upstream (smoke tests)

These are fast checks you can run outside Discord to confirm upstream connectivity.

### 1) Check your key is valid

```bash
curl -sS https://gen.pollinations.ai/account/profile   -H "Authorization: Bearer sk_YOUR_KEY" | head
```

### 2) Chat completion

```bash
curl -sS https://gen.pollinations.ai/v1/chat/completions   -H "Authorization: Bearer sk_YOUR_KEY"   -H "Content-Type: application/json"   -d '{
    "model": "kimi",
    "messages": [{"role":"user","content":"Say hello in one sentence."}]
  }' | head
```

### 3) Image generation

```bash
curl -L "https://gen.pollinations.ai/image/a%20cat%20wearing%20sunglasses?model=klein-large&seed=123&nologo=true&key=sk_YOUR_KEY"   --output test_image
```

---

## 🧯 Troubleshooting

### “Invalid API key” on set

- Re-run `/sage key login` and ensure you copied the exact `sk_...` token from the redirected URL.
- Confirm `auth.pollinations.ai` is not being used anywhere (deprecated).

### Public bot is slow or rate-limited

- Configure a server key via BYOP.
- Pollinations traffic varies by model and load; retry can help.

### Image edit didn’t use the image I replied to

- Make sure you used Discord **Reply** (not just quoted text).
- Sage only uses direct attachments or reply attachments for edit context.

### Voice/TTS does nothing

- Ensure the bot is in a voice channel (`/join`)
- Ensure a key is available (server key or `LLM_API_KEY`)

---

## 🔗 Resources

- Pollinations homepage: <https://pollinations.ai>
- Dashboard (keys, usage): <https://enter.pollinations.ai>
- API reference: <https://enter.pollinations.ai/api/docs>
- Featured apps: <https://pollinations.ai/apps>
- Deprecated auth notice: <https://auth.pollinations.ai/>

---

<p align="center">
  <sub>Powered by <a href="https://pollinations.ai">Pollinations.ai</a> 🐝</sub>
</p>
