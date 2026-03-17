# 🔌 API Examples

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20API%20Examples-2d5016?style=for-the-badge&labelColor=4a7c23" alt="API Examples" />
</p>

Annotated examples of the upstream request shapes Sage works with today.

> [!NOTE]
> These examples are illustrative, not byte-for-byte runtime dumps. Sage also sends its full system contract, tool definitions, and trusted runtime state where applicable.

---

## 🧭 Quick Navigation

- [Chat Completion](#chat-completion)
- [Vision (Image Analysis)](#vision-image-analysis)
- [Image Generation](#image-generation)
- [Image Editing](#image-editing)
- [Voice (STT)](#voice-stt)
- [Key Validation](#key-validation)

---

<a id="chat-completion"></a>

## 💬 Chat Completion

Sage's runtime expects an OpenAI-compatible chat-completions surface.

```bash
curl -sS https://your-provider.example/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-main-model",
    "messages": [
      { "role": "system", "content": "System contract omitted for brevity." },
      { "role": "user", "content": "What changed in the latest React docs?" }
    ]
  }'
```

If you want to validate a real provider/model pair against Sage's contract, use:

```bash
npm run ai-provider:probe
```

---

<a id="vision-image-analysis"></a>

## 👁️ Vision (Image Analysis)

When the configured model supports image inputs, Sage can send content parts like this:

```bash
curl -sS https://your-provider.example/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-vision-model",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Describe this image." },
          { "type": "image_url", "image_url": { "url": "https://example.com/photo.jpg" } }
        ]
      }
    ]
  }'
```

Vision enablement is budget/profile metadata in `AI_PROVIDER_MODEL_PROFILES_JSON`; verify the provider/model pair in practice with a live probe.

---

<a id="image-generation"></a>

## 🎨 Image Generation

Sage's current built-in image flow is Pollinations-specific:

```bash
curl -L "https://gen.pollinations.ai/image/a%20neon%20cyberpunk%20city%20at%20night?model=imagen-4&seed=42&nologo=true&key=sk_YOUR_KEY" \
  --output generated_image.jpg
```

Typical query parameters Sage uses:

| Parameter | Purpose |
| :--- | :--- |
| `model` | image model id |
| `seed` | reproducibility |
| `nologo` | watermark preference |
| `key` | BYOP or host/server key path |

---

<a id="image-editing"></a>

## ✏️ Image Editing

Reply-based image edits use the same endpoint with `image=<url>`:

```bash
curl -L "https://gen.pollinations.ai/image/make%20this%20look%20like%20a%20watercolor?model=imagen-4&seed=42&nologo=true&image=https://example.com/source.jpg&key=sk_YOUR_KEY" \
  --output edited_image.jpg
```

---

<a id="voice-stt"></a>

## 🔊 Voice (STT)

For local transcription, Sage uses the optional local voice service:

```bash
curl -sS http://127.0.0.1:11333/v1/stt/transcribe \
  -F "audio=@sample.wav;type=audio/wav"
```

The voice service is separate from the chat provider and separate from the Pollinations image/server-key path.

---

<a id="key-validation"></a>

## 🔑 Key Validation

Sage validates Pollinations BYOP keys before storing them:

```bash
curl -sS https://gen.pollinations.ai/account/profile \
  -H "Authorization: Bearer sk_YOUR_KEY"
```

That validation is specific to the current hosted/server-key flow.

---

## 🔗 Related Documentation

- [🐝 Pollinations Integration](POLLINATIONS.md)
- [🧩 Model Reference](MODELS.md)
- [⚙️ Configuration](CONFIGURATION.md)
- [🌸 BYOP Guide](../guides/BYOP.md)
