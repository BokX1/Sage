# 🐝 Pollinations.ai Integration

Sage runs on Pollinations.ai for **text**, **vision**, and **image generation**. This doc explains what Sage calls, how BYOP works, and where to verify the upstream API.

---

## 🔗 Useful links

- **Pollinations homepage:** <https://pollinations.ai>
- **Developer dashboard (keys, usage):** <https://enter.pollinations.ai>
- **API reference:** <https://enter.pollinations.ai/api/docs>

> [!NOTE]
> Pollinations has older/legacy endpoints documented in some places. Sage uses the **unified** `gen.pollinations.ai` API surface (see links above).

---

## 🌸 BYOP in Sage (Bring Your Own Pollen)

Sage supports **server-wide BYOP**: a server admin sets a Pollinations key once, and all members benefit.

### How `/sage key login` works

The bot sends an auth link like:

- `https://enter.pollinations.ai/authorize?redirect_url=https://pollinations.ai/&permissions=profile,balance,usage`

After sign-in, Pollinations redirects to a URL that contains:

- `https://pollinations.ai/#api_key=sk_...`

Copy the `sk_...` value and run:

```text
/sage key set <your_key>
```

### How `/sage key set` validates

Before saving, Sage validates the key by calling:

- `GET https://gen.pollinations.ai/account/profile` with `Authorization: Bearer sk_...`

If the profile call succeeds, Sage stores the key **scoped to the current Discord server**.

---

## 🧠 Text + vision (chat completions)

Sage uses an OpenAI-compatible chat interface on Pollinations.

**Endpoint family (base):**

- `https://gen.pollinations.ai/v1/chat/completions`

Sage can send multimodal messages by including both:

- `text`
- `image_url` (when a user attaches/replies with an image)

---

## 🎨 Image generation and editing

Sage can:

- **Generate images** from text prompts
- **Edit images** (image-to-image) when the user attaches/replies with an image

### What Sage calls

Sage fetches raw image bytes from Pollinations using a URL-style endpoint:

- `GET https://gen.pollinations.ai/image/{prompt}`

Sage appends query parameters such as:

- `model` (current default in code: `klein-large`)
- `seed`
- `nologo`
- `key=sk_...` (when BYOP is enabled)

When editing an image, Sage also includes an `image=<url>` parameter referencing the source image.

> [!NOTE]
> Pollinations also supports `width`/`height` query parameters, but Sage does not currently set them explicitly (Pollinations defaults apply).

### What users do in Discord

No slash command is required:

- **Generate:** `Sage, draw a neon cyberpunk street scene`
- **Edit:** reply to an image: `Sage, make this look like a watercolor poster`

Sage replies with an **image attachment** (and may add a short caption).

---

## ✅ Troubleshooting

- **Public bot is silent / prompts for setup:** BYOP is required on servers (admin must run `/sage key login` → `/sage key set`).
- **“Invalid API key” on set:** re-run `/sage key login` and ensure you copied the `sk_...` token from the redirected URL.
- **Image generation works but is slow:** Pollinations latency varies by model/traffic; retry, or use a server key for better throughput.

---

<p align="center">
  <sub>Powered by <a href="https://pollinations.ai">Pollinations.ai</a> 🐝</sub>
</p>
