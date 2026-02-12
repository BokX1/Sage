# Contributing to Sage

Thanks for helping improve Sage! This guide covers the local workflow, expectations, and safety notes.

---

## 📋 Quick Reference

| Action | Command |
| :--- | :--- |
| Install deps | `npm install && npm run setup` |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Test | `npm run test` |
| Health check | `npm run doctor` |
| DB sync | `npx prisma db push` |

---

## ⚖️ License and Contribution Terms

- Sage is source-available under **PolyForm Strict 1.0.0** (`LICENSE`).
- The public license permits noncommercial use only and does not permit redistribution, modification, or derivative works.
- The copyright owner grants a limited additional permission to create modifications solely to prepare and submit pull requests to this repository.
- By submitting code, docs, or assets, you grant the project owner the right to use, modify, relicense, and distribute your contribution under Sage's licensing model (including commercial licensing).

---

## 🔧 Prerequisites

| Requirement | Details |
| :--- | :--- |
| **Node.js** | LTS version (CI runs on Node 18.x and 20.x) |
| **Database** | PostgreSQL via Docker (see `prisma/schema.prisma`) |
| **Discord creds** | `DISCORD_TOKEN` and `DISCORD_APP_ID` in `.env` |

---

## 🚀 Setup

```bash
npm install
npm run setup
```

If you need to sync the database schema locally (no migrations):

```bash
npx prisma db push
```

To reset the schema (⚠️ deletes data):

```bash
npx prisma db push --force-reset --accept-data-loss
```

---

## 🔄 Development Workflow

```mermaid
flowchart LR
    classDef action fill:#d4edda,stroke:#155724,color:black
    classDef check fill:#cce5ff,stroke:#004085,color:black
    classDef submit fill:#fff3cd,stroke:#856404,color:black

    A["Branch from master"]:::action --> B["Write code + tests"]:::action
    B --> C["npm run lint"]:::check
    C --> D["npm run build"]:::check
    D --> E["npm run test"]:::check
    E --> F["Open PR"]:::submit
    F --> G["CI passes"]:::check
    G --> H["Review + Merge"]:::submit
```

### Branching

- Create feature branches from `master`.
- Keep PRs focused and avoid unrelated refactors.
- Include clear, testable descriptions of changes and any operational impacts.

---

## 🏗️ Architecture Overview (for Contributors)

Understanding the codebase structure helps you contribute effectively:

```text
src/
├── core/
│   ├── orchestration/     # Agent selector, runtime, canary, critics
│   ├── llm/               # Model resolver, catalog, health tracking
│   ├── context/           # Context packet providers (UserMemory, ChannelMemory, SocialGraph, VoiceAnalytics)
│   ├── tools/             # Search, scrape, GitHub, npm, wiki tools
│   └── voice/             # Voice presence, sessions, analytics
├── services/              # Pollinations, ingestion, formatting
└── shared/
    └── config/            # Environment validation (Zod schemas)
```

> [!TIP]
> Start with `src/core/agentRuntime/agentRuntime.ts` — it's the main entry point for understanding how messages flow through Sage.

---

## 🎨 Code Style

- Follow the existing **ESLint** and **Prettier** configuration (located in `config/ci/`).
- Favor **small, well-named modules** and pure functions for core logic.
- Avoid introducing new prompt strings or altering existing prompt templates unless fixing a bug.

Run the formatter:

```bash
npm run lint -- --fix
```

---

## ✅ Pull Request Checklist

Before opening a PR, verify each item:

- [ ] Code compiles: `npm run build`
- [ ] All tests pass: `npm run test`
- [ ] Linting passes: `npm run lint`
- [ ] New features include tests
- [ ] No secrets committed (`.env` must remain ignored)
- [ ] Documentation updated if behavior changed
- [ ] Commit messages are descriptive

---

## 🛡️ Adding Features Safely

- Add tests for core logic and any new tool execution paths.
- Ensure provider payloads remain backward compatible.
- Validate inputs and handle failures gracefully.
- For behavior changes, add or update tests.

---

## 🔒 Security Notes

- **Never commit secrets.** `.env` must remain in `.gitignore`.
- Use placeholders in `.env.example` only.
- Report vulnerabilities to the project owner — see [`SECURITY.md`](docs/security/SECURITY_PRIVACY.md).

---

## 🤖 CI Expectations

The CI workflow runs <kbd>lint</kbd> → <kbd>build</kbd> → <kbd>test</kbd>. Run these locally before opening a PR:

```bash
npm run lint && npm run build && npm run test
```

---

## 📚 Further Reading

- [📖 Getting Started](docs/guides/GETTING_STARTED.md) — Full setup walkthrough
- [🤖 Architecture Overview](docs/architecture/OVERVIEW.md) — Agentic design
- [⚙️ Configuration Reference](docs/reference/CONFIGURATION.md) — All env vars
- [🔀 Runtime Pipeline](docs/architecture/PIPELINE.md) — Message flow
