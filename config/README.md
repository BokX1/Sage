# Configuration Layout

This directory contains configuration files consumed by CI, local development tools, and optional self-hosted providers.

## Directories

| Path | Purpose | Primary Consumers |
| :--- | :--- | :--- |
| `config/ci/` | Build, lint, test, and local infrastructure defaults used in day-to-day development. | `package.json` scripts, `.github/workflows/ci.yml`, onboarding/docs commands |
| `config/self-host/` | Optional self-hosted provider stack for search/scrape/local model and file ingestion services. | `docs/operations/TOOL_STACK.md`, `.env` self-host profiles |

## `config/ci` Files

| File | Purpose |
| :--- | :--- |
| `config/ci/tsconfig.json` | TypeScript compile and typecheck settings used by build/check scripts. |
| `config/ci/eslint.config.mjs` | ESLint policy used by `npm run lint`. |
| `config/ci/vitest.config.mjs` | Vitest configuration used by `npm run test`. |
| `config/ci/.prettierrc` | Prettier formatting defaults. |
| `config/ci/docker-compose.yml` | Local Postgres + Tika stack used for dev/testing workflows. |
| `config/ci/markdownlint.markdownlint-cli2.jsonc` | Markdown lint rules used by the docs CI job. |

## `config/self-host` Files

| File | Purpose |
| :--- | :--- |
| `config/self-host/docker-compose.tools.yml` | Local-first tool stack (SearXNG, Crawl4AI, Ollama, Tika). |
| `config/self-host/searxng/settings.yml` | SearXNG settings template for local development. |

## Maintenance Rules

1. Treat `config/ci/` as the canonical source for script and CI config paths.
2. Keep `config/self-host/` defaults local-only and non-production by design.
3. If renaming a config file, update all references in `.github/workflows`, `package.json`, scripts, and docs in the same change.
