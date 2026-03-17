# 🔒 Security Policy

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Security%20Policy-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Security Policy" />
</p>

## Supported Versions

| Version | Supported |
| :--- | :--- |
| 1.0.x | ✅ Active Support |
| < 1.0 | ❌ No longer supported |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Sage, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Create a **private security advisory** via [GitHub Security Advisories](https://github.com/BokX1/Sage/security/advisories)
3. Or contact the maintainers directly through Discord

### What to Include

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fix (if you have one)

### Response Timeline

| Action | Timeline |
| :--- | :--- |
| Initial acknowledgment | 48 hours |
| Preliminary assessment | 7 days |
| Fix development | 14-30 days (depending on severity) |
| Public disclosure | After fix is released |

## Security Best Practices

When deploying Sage:

### Environment Variables

- **Never commit** `.env` files with real credentials
- Use environment variable management in production (secrets managers)
- Rotate your `DISCORD_TOKEN` if you suspect compromise
- Treat `AI_PROVIDER_API_KEY`, `IMAGE_PROVIDER_API_KEY`, `SERVER_PROVIDER_API_KEY`, and any guild BYOP/server keys as production secrets

### Database

- Use strong passwords for PostgreSQL
- Restrict database access to the bot's IP only
- Regularly backup your database

### API Keys

- Keep `AI_PROVIDER_API_KEY`, image-provider keys, and any guild/server BYOP key private
- Generate keys with minimal required permissions
- Revoke and regenerate keys periodically

### Discord Bot Permissions

- Use the **minimum permissions** required
- Avoid granting Administrator permission in production
- Regularly audit the bot's role permissions

## Known Security Considerations

### Data Storage

Sage stores the following data:

- User messages (configurable retention)
- User profiles (AI-generated summaries)
- Voice channel session data
- Relationship graph data

See [Security & Privacy](docs/security/SECURITY_PRIVACY.md) for full details.

### Third-Party Services

- **AI Provider**: Sage sends chat, profile, and summary requests to whichever OpenAI-compatible endpoint you configure via `AI_PROVIDER_BASE_URL`. The current hosted deployment uses [Pollinations.ai](https://pollinations.ai) as the default provider.
- **Image Provider**: Image generation and editing requests go to the endpoint configured via `IMAGE_PROVIDER_BASE_URL`.
- **Server-key validation path**: Sage's current hosted server-key validation and BYOP flow are Pollinations-specific today.
- Review the privacy policy of your chosen AI and image providers.
