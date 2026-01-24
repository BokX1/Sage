# 🐝 Pollinations.ai Integration

Sage is powered by **[Pollinations.ai](https://pollinations.ai)** — an open platform that provides access to multiple language models via an OpenAI-compatible API.

This page explains:

- What Pollinations provides
- How Sage uses it
- Which settings to change in `.env`
- How BYOP keys work in Discord

---

## 🧭 Quick navigation

- [✅ Why Pollinations.ai?](#why-pollinationsai)
- [🔧 How Sage Uses Pollinations](#how-sage-uses-pollinations)
- [🌸 BYOP: Keys in Discord](#byop-keys-in-discord)
- [⚙️ Host Configuration (`.env`)](#host-configuration-env)
- [🧪 Discover available models](#discover-available-models)
- [🌟 Features Sage Uses](#features-sage-uses)
- [📊 API Usage Tips](#api-usage-tips)
- [🔗 Resources](#resources)

---

## ✅ Why Pollinations.ai?

| Benefit | What It Means for You |
|:--------|:----------------------|
| **Free API access** | No credit card required; free tier available |
| **Multi-model support** | Choose from Gemini, DeepSeek, OpenAI, and more |
| **OpenAI-compatible** | Easy integration and familiar request format |
| **Vision support** | Image understanding is supported by vision-capable models |
| **Community-driven** | Open-source with active development |

---

## 🔧 How Sage Uses Pollinations

Sage uses different models for specialized tasks:

| Task | Model | Purpose |
|:-----|:------|:--------|
| **Chat** | `gemini` (configurable) | Main conversations with users |
| **Profile Analysis** | `deepseek` | Building user memory profiles |
| **Summaries** | `openai-large` | Channel conversation summaries |
| **JSON Formatting** | `qwen-coder` | Structured data extraction |
| **Voice** | `openai-audio` | Text-to-speech companion responses |

> [!NOTE]
> You can override these defaults in `.env`. See [Configuration](CONFIGURATION.md) for the full list.

---

## 🌸 BYOP: Keys in Discord

Sage supports BYOP (Bring Your Own Pollen) via Discord commands:

1. Run `/sage key login`
2. Follow the link and log in to Pollinations.ai
3. Copy the `sk_...` key from the URL
4. Run `/sage key set <key>`

This sets a **server-wide key** used for all AI requests from that server.

For a step-by-step guide, see **[BYOP Mode](BYOP_MODE.md)**.

---

## ⚙️ Host Configuration (`.env`)

If you self-host, you can set defaults in `.env`:

```env
POLLINATIONS_MODEL=gemini
# POLLINATIONS_API_KEY provides a global fallback if a server key is not set.
```

### Override models for specific tasks

```env
# Main chat model
POLLINATIONS_MODEL=gemini

# Profile memory updates
PROFILE_POLLINATIONS_MODEL=deepseek

# Channel summaries
SUMMARY_MODEL=openai-large

# JSON formatting
FORMATTER_MODEL=qwen-coder
```

---

## 🧪 Discover available models

You can view available models during onboarding:

```bash
npm run onboard
# Type "list" when prompted for model selection
```

Or browse models at https://pollinations.ai/.

---

## 🌟 Features Sage Uses

### Text generation
- Conversational responses
- Memory-aware personalization
- Context-rich dialogue

### Vision (image understanding)
- Analyze images shared in Discord
- Discuss visual content
- Multi-modal conversations

### Voice synthesis (TTS)
- Text-to-speech companion responses
- Dynamic persona adaptation
- Expressive audio output

### Structured output
- JSON extraction for profiles
- Summary generation
- Data organization

---

## 📊 API Usage Tips

### Rate limits
- Free tier has generous limits
- Setting an API key unlocks higher quotas
- Sage automatically handles rate limiting

### Optimization
- Sage uses context budgeting to stay within limits
- Specialized models for different tasks reduce costs
- Caching reduces redundant calls

---

## 🔗 Resources

- **Pollinations website:** https://pollinations.ai/
- **API documentation:** https://enter.pollinations.ai/api/docs
- **Featured apps:** https://pollinations.ai/apps
- **GitHub:** https://github.com/pollinations

---

<p align="center">
  <a href="https://pollinations.ai">
    <img src="https://pollinations.ai/favicon.ico" alt="Pollinations.ai" width="48" />
  </a>
</p>

<p align="center">
  <sub>Build AI apps with easy APIs, daily grants, and community support</sub>
</p>