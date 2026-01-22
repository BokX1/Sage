# Pollinations.ai Integration

Sage is proudly powered by **[Pollinations.ai](https://pollinations.ai)** — a free, open-source AI platform providing easy access to cutting-edge language models.

---

## 🐝 Why Pollinations.ai?

| Benefit | What It Means for You |
|:--------|:---------------------|
| **Free API Access** | No credit card required, free tier available |
| **Multi-Model Access** | Choose from Gemini, DeepSeek, OpenAI, and more |
| **Easy Integration** | Simple REST API, OpenAI-compatible format |
| **Vision Support** | Image understanding built-in |
| **Community-Driven** | Open-source with active development |

---

## 🔧 How Sage Uses Pollinations

Sage uses different Pollinations models for specialized tasks:

| Task | Model | Purpose |
|:-----|:------|:--------|
| **Chat** | `gemini` (configurable) | Main conversations with users |
| **Profile Analysis** | `deepseek` | Building user memory profiles |
| **Summaries** | `openai-large` | Creating channel conversation summaries |
| **JSON Formatting** | `qwen-coder` | Structured data extraction |

---

## ⚙️ Configuration

### Basic Setup (BYOP)

Sage uses a **Bring Your Own Pollen** model.

1.  **Get a Key:** Type `/sage key login` in Discord.
2.  **Set the Key:** Type `/sage key set <key>`.

This key is used for all AI operations in your server.

### Host Configuration (Optional)

If you are self-hosting, you can set defaults in `.env`:

```env
POLLINATIONS_MODEL=gemini
# POLLINATIONS_API_KEY is not used for guild chats in Strict BYOP mode.
```

### Advanced Model Configuration

Override models for specific tasks:

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

### Available Models

Run the onboarding wizard to see all available models:

```bash
npm run onboard
# Type "list" when prompted for model selection
```

Or browse models at [pollinations.ai](https://pollinations.ai/).

---

## 🌟 Features Used

### Text Generation

- Conversational responses
- Memory-aware personalization
- Context-rich dialogue

### Vision (Image Understanding)

- Analyze images shared in Discord
- Discuss visual content
- Multi-modal conversations

### Structured Output

- JSON extraction for profiles
- Summary generation
- Data organization

---

## 📊 API Usage Tips

### Rate Limits

- Free tier has generous limits
- API key unlocks higher quotas
- Sage automatically handles rate limiting

### Optimization

- Sage uses context budgeting to stay within limits
- Specialized models for different tasks reduce costs
- Efficient caching reduces redundant calls

---

## 🔗 Resources

- **Pollinations Website:** [pollinations.ai](https://pollinations.ai/)
- **API Documentation:** [enter.pollinations.ai/api/docs](https://enter.pollinations.ai/api/docs)
- **Featured Apps:** [pollinations.ai/apps](https://pollinations.ai/apps)
- **GitHub:** [github.com/pollinations](https://github.com/pollinations)

---

## 🤝 About Pollinations.ai

Pollinations.ai provides free, open-source AI APIs for developers and creators. Their mission is to make AI accessible to everyone through easy-to-use tools and generous free tiers.

Sage is a proud member of the Pollinations ecosystem, demonstrating how the platform can power intelligent, memory-aware Discord experiences.

---

<p align="center">
  <a href="https://pollinations.ai">
    <img src="https://pollinations.ai/favicon.ico" alt="Pollinations.ai" width="48" />
  </a>
</p>

<p align="center">
  <sub>Build AI apps with easy APIs, daily grants, and community support</sub>
</p>
