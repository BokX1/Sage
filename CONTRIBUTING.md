# Contributing to Sage

Thanks for helping improve Sage! This guide covers the local workflow, expectations, and safety notes.

## License and contribution terms

- Sage is proprietary software (All Rights Reserved).
- By submitting code, docs, or assets, you agree your contribution may be used, modified, and distributed by the project owner under Sage's proprietary licensing model.
- Contributions do not grant redistribution rights to the Sage codebase outside terms explicitly granted by the copyright owner.

## Prerequisites

- **Node.js**: Use an LTS version (CI runs on Node 18.x and 20.x).
- **Database**: Prisma is configured for PostgreSQL by default (see `prisma/schema.prisma`). Set `DATABASE_URL` in your `.env`.
- **Discord app credentials**: Provide `DISCORD_TOKEN` and `DISCORD_APP_ID` in your `.env` for local bot runs.

## Setup

```bash
npm install
npm run setup
```

If you need database migrations locally:

```bash
npm run db:migrate
```

## Development scripts

- `npm run dev` — run the bot with `nodemon` + `ts-node`
- `npm run lint` — run ESLint
- `npm run build` — compile TypeScript
- `npm run test` — run unit tests with Vitest
- `npm run doctor` — sanity checks for configuration

## Branching + PR guidance

- Create feature branches from `master`.
- Keep PRs focused and avoid unrelated refactors.
- Include clear, testable descriptions of changes and any operational impacts.
- For behavior changes, add or update tests.

## Code style

- Follow the existing ESLint and Prettier configuration (located in `config/ci/`).
- Favor small, well-named modules and pure functions for core logic.
- Avoid introducing new prompt strings or altering existing prompt templates unless fixing a bug.

## Adding features safely

- Add tests for core logic and any new tool execution paths.
- Ensure provider payloads remain backward compatible.
- Validate inputs and handle failures gracefully.

## Security notes

- **Never commit secrets**. `.env` must remain ignored.
- Use placeholders in `.env.example` only.

## CI expectations

The CI workflow runs `lint`, `build`, and `test`. Run these locally before opening a PR:

```bash
npm run lint
npm run build
npm run test
```
