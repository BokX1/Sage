# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| 1.0.x | ✅ Active Support |
| < 1.0 | ❌ No longer supported |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in Sage, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Create a **private security advisory** via [GitHub Security Advisories](https://github.com/BokX1/Sage/security/advisories/new)
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

### Database

- Use strong passwords for PostgreSQL
- Restrict database access to the bot's IP only
- Regularly backup your database

### API Keys

- Keep your `LLM_API_KEY` (or BYOP server key) private
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

- **Pollinations.ai**: All AI requests are sent to Pollinations
- Messages are processed through their API
- Review their privacy policy at [pollinations.ai](https://pollinations.ai)
