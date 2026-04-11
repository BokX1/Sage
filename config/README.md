# Configuration Layout

This directory contains tracked configuration consumed by CI, local development tooling, and local service stacks.

## Directories

| Path | Purpose | Primary Consumers |
| :--- | :--- | :--- |
| `config/tooling/` | Build, lint, test, docs, and hook policy used by tracked repo automation. | `package.json` scripts, `scripts/hooks/`, `scripts/docs/`, `.github/workflows/*.yml` |
| `config/services/core/` | Core local service stack for day-to-day development. | `npm run onboard`, `npm run doctor`, onboarding/docs commands |
| `config/services/self-host/` | Optional self-hosted provider stack for search, scrape, voice, and file-ingest services. | `docs/operations/TOOL_STACK.md`, `.env` self-host profiles |

## `config/tooling` Files

| File | Purpose |
| :--- | :--- |
| `config/tooling/tsconfig.app.json` | TypeScript compile and typecheck settings used by build/check scripts. |
| `config/tooling/tsconfig.tests.json` | Test-only TypeScript configuration used by `npm run typecheck`. |
| `config/tooling/eslint.config.mjs` | ESLint policy used by `npm run lint`. |
| `config/tooling/vitest.config.mjs` | Vitest configuration used by `npm run test`. |
| `config/tooling/prettier.config.json` | Prettier formatting defaults. |
| `config/tooling/sage.markdownlint-cli2.jsonc` | Markdown lint rules used by the tracked docs gate in CI and local workflows. |
| `config/tooling/docs-links.json` | Machine-readable docs link-check policy shared by local and CI docs validation. |

## `config/services` Files

| File | Purpose |
| :--- | :--- |
| `config/services/core/docker-compose.yml` | Local Postgres + Tika stack used for dev/testing workflows. |
| `config/services/self-host/docker-compose.tools.yml` | Local-first tool stack (SearXNG, Crawl4AI, Tika). |
| `config/services/self-host/docker-compose.voice.yml` | Local voice/STT service for Discord voice development. |
| `config/services/self-host/docker-compose.social-graph.yml` | Optional Memgraph + Redpanda stack for social-graph analytics and MAGE modules. |
| `config/services/self-host/searxng/settings.yml` | SearXNG settings template for local development. |

## Maintenance Rules

1. Treat `config/tooling/` as the canonical source for tracked build and docs config.
2. Keep `config/services/` defaults local-first and non-production by design.
3. If renaming a config file, update all references in `.github/workflows`, `package.json`, scripts, and docs in the same change.
