# 🔌 API Examples

Annotated examples of what Sage sends upstream to [Pollinations.ai](https://pollinations.ai). Use these to debug connectivity, test your BYOP key, or understand Sage's request patterns.

> [!NOTE]
> Replace `sk_YOUR_KEY` with your actual Pollinations secret key. All examples use `curl` and can be run from any terminal.

---

## 🧭 Quick Navigation

- [Chat Completion](#-chat-completion)
- [Vision (Image Analysis)](#-vision-image-analysis)
- [Image Generation](#-image-generation)
- [Image Editing](#-image-editing)
- [Voice (TTS)](#-voice-tts)
- [Key Validation](#-key-validation)

---

<a id="chat-completion"></a>

## 💬 Chat Completion

The most common request — what Sage sends for every text conversation:

```bash
curl -sS https://gen.pollinations.ai/v1/chat/completions \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai-large",
    "messages": [
      {
        "role": "system",
        "content": "You are Sage, a friendly AI companion in a Discord server."
      },
      {
        "role": "user",
        "content": "What is TypeScript?"
      }
    ]
  }'
```

<details>
<summary><strong>Expected response shape</strong></summary>

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "TypeScript is a strongly-typed superset of JavaScript..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 128,
    "total_tokens": 170
  }
}
```

</details>

---

<a id="vision-image-analysis"></a>

## 👁️ Vision (Image Analysis)

When a user attaches an image, Sage sends multimodal content parts:

```bash
curl -sS https://gen.pollinations.ai/v1/chat/completions \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai-large",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Describe what you see in this image."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/photo.jpg"
            }
          }
        ]
      }
    ]
  }'
```

> [!IMPORTANT]
> The model must have `vision` capability. Sage's model resolver automatically selects a vision-capable model when image content is detected.

---

<a id="image-generation"></a>

## 🎨 Image Generation

Sage fetches raw image bytes from the Pollinations image endpoint:

```bash
curl -L "https://gen.pollinations.ai/image/a%20neon%20cyberpunk%20city%20at%20night?model=imagen-4&seed=42&nologo=true&key=sk_YOUR_KEY" \
  --output generated_image.jpg
```

### Parameters Sage Sends

| Parameter | Value | Purpose |
| :--- | :--- | :--- |
| `model` | `imagen-4` | Image model (default) |
| `seed` | Random integer | Reproducibility per request |
| `nologo` | `true` | Removes Pollinations watermark |
| `key` | `sk_...` | BYOP or global API key |

> [!TIP]
> Sage runs an **agentic prompt refiner** before calling this endpoint. It rewrites the user's request into an image-optimized prompt using recent conversation context, which is why results are often better than a raw prompt would produce.

---

<a id="image-editing"></a>

## ✏️ Image Editing

When a user replies to an image with an edit request, Sage adds the `image` parameter:

```bash
curl -L "https://gen.pollinations.ai/image/make%20it%20look%20like%20a%20watercolor%20painting?model=imagen-4&seed=42&nologo=true&image=https://example.com/source.jpg&key=sk_YOUR_KEY" \
  --output edited_image.jpg
```

The difference from generation is the `image=<url>` parameter, which provides the source image for editing.

---

<a id="voice-tts"></a>

## 🔊 Voice (TTS)

For text-to-speech in voice channels, Sage uses the `openai-audio` model:

```bash
curl -sS https://gen.pollinations.ai/v1/chat/completions \
  -H "Authorization: Bearer sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai-audio",
    "messages": [
      {
        "role": "system",
        "content": "Respond naturally as Sage speaking in a Discord voice channel."
      },
      {
        "role": "user",
        "content": "Tell me a fun fact about space."
      }
    ]
  }'
```

> [!WARNING]
> TTS **requires** a valid Pollinations key (either server BYOP key or `LLM_API_KEY`). Without a key, voice features are silently skipped.

---

<a id="key-validation"></a>

## 🔑 Key Validation

Sage validates BYOP keys before storing them by calling the profile endpoint:

```bash
curl -sS https://gen.pollinations.ai/account/profile \
  -H "Authorization: Bearer sk_YOUR_KEY"
```

<details>
<summary><strong>Expected response shape</strong></summary>

```json
{
  "id": "user_abc123",
  "email": "you@example.com",
  "plan": "free",
  "usage": {
    "requests": 1234,
    "tokens": 567890
  }
}
```

</details>

---

## 🔗 Related Documentation

- [🐝 Pollinations Integration](POLLINATIONS.md) — Full integration reference
- [🧩 Model Reference](MODELS.md) — How models are selected per route
- [⚙️ Configuration](CONFIGURATION.md) — Environment variables for LLM settings
- [🌸 BYOP Guide](../guides/BYOP.md) — How to set up Bring-Your-Own-Pollen keys
