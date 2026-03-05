# 🐝 Pollinations.ai Integration

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Pollinations-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Pollinations" />
</p>

Sage runs on **Pollinations.ai** for **text**, **vision**, and **image generation**.

This document is written for:

- **Users** (how to use Sage in Discord)
- **Server admins** (how BYOP keys work)
- **Self-hosters** (which `.env` settings matter)
- **Reviewers** (what Sage calls upstream, and how to verify it)

> [!IMPORTANT]
> Pollinations has gone through an auth migration: **token/key management moved to `enter.pollinations.ai`** and the old `auth.pollinations.ai` service is deprecated.

```mermaid
flowchart LR
    classDef sage fill:#cce5ff,stroke:#004085,color:black
    classDef api fill:#d4edda,stroke:#155724,color:black
    classDef mgmt fill:#fff3cd,stroke:#856404,color:black

    S[Sage Bot]:::sage --> T["gen.pollinations.ai/v1/chat/completions"]:::api
    S --> I["gen.pollinations.ai/image/{prompt}"]:::api
    S --> P["gen.pollinations.ai/account/profile"]:::mgmt
    A[Admin] --> D["enter.pollinations.ai"]:::mgmt
```

---

## 🧭 Quick navigation

- [✅ What Sage uses Pollinations for](#-what-sage-uses-pollinations-for)
- [🔗 Hosts and endpoints (the “unified” surface)](#-hosts-and-endpoints-the-unified-surface)
- [🌸 BYOP: server-wide keys in Discord](#-byop-server-wide-keys-in-discord)
- [⚙️ Self-host configuration (`.env`)](#-self-host-configuration-env)
- [🧠 Text + vision (OpenAI-compatible chat)](#-text--vision-openai-compatible-chat)
- [🎨 Image generation + image editing](#-image-generation--image-editing)
- [✅ Verify Pollinations upstream (smoke tests)](#-verify-pollinations-upstream-smoke-tests)
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

Pollinations positions itself as a **unified API** for multiple modalities (text/images/audio, etc.).

---

## 🔗 Hosts and endpoints (the “unified” surface)

Sage uses these Pollinations hosts:

- **Dashboard + accounts + keys**: <https://enter.pollinations.ai> (manage keys, usage, account)
- **OpenAI-compatible API base**: `gen.pollinations.ai/v1`
- **Image bytes endpoint**: `gen.pollinations.ai/image/{prompt}`

> [!NOTE]
> You may still find older docs or examples using different hosts/subdomains. Sage’s current integration assumes the **enter + gen** split above, and the deprecated auth host should not be used.

---

## 🌸 BYOP: server-wide keys in Discord

Sage supports **Bring Your Own Pollen (BYOP)**: a **server admin** sets a Pollinations **Secret key** once, and Sage uses it for that server.

### Key types (what to paste)

- Use **Secret keys** that start with `sk_...`
- Sage trims accidental leading/trailing whitespace before validating and storing a key.
- Do **not** paste keys in public channels. Use Sage’s **ephemeral** command replies.

### How `/sage key login` works

1. Run: `/sage key login`
2. Sage gives an auth link to Pollinations:
   - <https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage>
3. After you sign in, Pollinations redirects you to a URL containing:
   - <https://pollinations.ai/#api_key=sk_...>
4. Copy the `sk_...` part and run:
   - `/sage key set <sk_...>`

### How Sage validates your key

Before storing, Sage verifies the key by calling:

- `GET gen.pollinations.ai/account/profile` with header `Authorization: Bearer sk_...`

If that succeeds, Sage stores the key **scoped to the current Discord server**.
Sage accepts successful authenticated profile responses and extracts account fields (`id`, `username`, balance) when available.

### Key precedence (what Sage actually uses)

When Sage needs a key, it resolves in this order:

1. **Server key** (set via `/sage key set`)
2. **Host-level fallback** (`LLM_API_KEY` in `.env`)
3. If neither exists, Sage returns setup guidance and cannot complete chat requests until a key is configured.

---

## ⚙️ Self-host configuration (`.env`)

Minimum Pollinations settings (see `.env.example` for the full list):

```env
LLM_PROVIDER=pollinations
LLM_BASE_URL=<pollinations-v1-base-url>
CHAT_MODEL=kimi

# Optional: Global fallback key (used if no BYOP key is set for the server)
LLM_API_KEY=
```

### Recommended: keep `LLM_BASE_URL` at the `/v1` root

Sage will append `/chat/completions` internally. If you accidentally include `/chat/completions` in the base URL, Sage normalizes it, but keeping it clean avoids confusion.

### Common model overrides (optional)

These are **defaults** you can customize:

```env
# Main baseline chat model (route policy may switch models per turn)
CHAT_MODEL=kimi

# Profile/memory updates
PROFILE_CHAT_MODEL=deepseek

# Channel summaries
SUMMARY_MODEL=deepseek
```

> [!NOTE]
> Image generation uses a Pollinations image model (currently set in code). See the Image section below for details.

---

## 🧠 Text + vision (OpenAI-compatible chat)

Sage uses Pollinations via the OpenAI-compatible endpoint:

- `POST gen.pollinations.ai/v1/chat/completions`

Runtime request shaping:

- Sage consolidates multiple system instructions into one system message block before sending.
- Sage then normalizes message sequencing for strict providers (for example to avoid invalid role alternation).
- Sage bounds client-side timeout and retry overrides to safe ranges (timeout: `1000`-`300000` ms, retries: `0`-`5`) to avoid invalid values causing immediate aborts or skipped execution attempts.

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
        { "type": "image_url", "image_url": { "url": "<image-url>" } }
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

- `GET gen.pollinations.ai/image/{prompt}`

Sage appends query parameters:

- `model` (default in code: `imagen-4`)
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

## 🔊 Voice (STT) in Sage

Sage's optional Discord voice transcription features (local STT) are handled by Sage's optional local voice service, not Pollinations.

See: `docs/architecture/VOICE.md`.

---

## ✅ Verify Pollinations upstream (smoke tests)

These are fast checks you can run outside Discord to confirm upstream connectivity.

### 1) Check your key is valid

```bash
POLLINATIONS_API="https://gen.pollinations.ai"
curl -sS "$POLLINATIONS_API/account/profile" -H "Authorization: Bearer sk_YOUR_KEY" | head
```

### 2) Chat completion

```bash
POLLINATIONS_API="https://gen.pollinations.ai"
curl -sS "$POLLINATIONS_API/v1/chat/completions" -H "Authorization: Bearer sk_YOUR_KEY" -H "Content-Type: application/json" -d '{
    "model": "kimi",
    "messages": [{"role":"user","content":"Say hello in one sentence."}]
  }' | head
```

### 3) Image generation

```bash
POLLINATIONS_API="https://gen.pollinations.ai"
curl -L "$POLLINATIONS_API/image/a%20cat%20wearing%20sunglasses?model=imagen-4&seed=123&nologo=true&key=sk_YOUR_KEY" --output test_image
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
- Sage uses images from: message attachments, replied-to message attachments, stickers, embed preview images (when available), and direct image URLs ending in common extensions (for example, `.png`, `.jpg`, `.webp`, `.gif`).
- If you invoke Sage with an image but no text (mention/wakeword only), Sage will apply a default “describe the image” prompt.

### Voice transcription does nothing

- Ensure the bot is in a voice channel (`/join`)
- Ensure `VOICE_STT_ENABLED=true`
- Ensure the local voice service is running and reachable at `VOICE_SERVICE_BASE_URL` (see `config/self-host/docker-compose.voice.yml`)

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
