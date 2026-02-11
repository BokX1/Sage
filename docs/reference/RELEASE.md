# 🚢 Release Process

This project follows **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`.

---

## 🧭 Quick navigation

- [🧾 Changelog](#changelog)
- [✅ Release checklist](#release-checklist)
- [🧪 Run locally like CI](#run-locally-like-ci)
- [🔍 Release readiness check (recommended)](#release-readiness-check-recommended)
- [👀 PR review expectations](#pr-review-expectations)

---

<a id="changelog"></a>

## 🧾 Changelog

- Update `CHANGELOG.md` for every user-facing change.
- Group entries by version and date.
- Note any database schema changes, configuration changes, or breaking behavior.

---

<a id="release-checklist"></a>

## ✅ Release checklist

1. **Update version**
   - `package.json`
   - `CHANGELOG.md`

2. **Run validations**
   - `npm run lint`
   - `npm run build`
   - Run `npm run doctor` to check compatibility.
   - `npm run test`
   - `npm run agentic:replay-gate`
   - `npm run eval:gate`
   - `npm run agentic:consistency-check`
   - `npm run release:agentic-check` (recommended single command)
   - `npm pack`

3. **Review database schema changes** (if applicable)
   - Document required steps in `CHANGELOG.md` and/or docs.

4. **Confirm configuration changes**
   - If you add/remove env vars, update [Configuration](CONFIGURATION.md) and any setup docs.

5. **Tag the release** and publish artifacts (if applicable)

---

<a id="run-locally-like-ci"></a>

## 🧪 Run locally like CI

```bash
npm ci
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/sage?schema=public npx prisma migrate deploy
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/sage?schema=public npm run agentic:consistency-check
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/sage?schema=public REPLAY_GATE_REQUIRE_DATA=0 EVAL_GATE_REQUIRE_DATA=0 EVAL_GATE_MIN_TOTAL=0 npm run release:agentic-check
```

### Windows (PowerShell)

```powershell
npm ci
$env:NODE_ENV="test"
$env:DISCORD_TOKEN="test-token"
$env:DISCORD_APP_ID="test-app-id"
$env:DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/sage?schema=public"
$env:REPLAY_GATE_REQUIRE_DATA="0"
$env:EVAL_GATE_REQUIRE_DATA="0"
$env:EVAL_GATE_MIN_TOTAL="0"
npx prisma migrate deploy
npm run agentic:consistency-check
npm run release:agentic-check
```

---

<a id="release-readiness-check-recommended"></a>

## 🔍 Release readiness check (recommended)

```bash
npm run release:agentic-check
```

This command enforces:

- lint/build/unit test suite
- roadmap consistency gate (Phase 0 foundation)
- replay quality gate
- model-judge eval gate

---

<a id="pr-review-expectations"></a>

## 👀 PR review expectations

- PRs should include a concise summary, test results, and operational notes.
- Risky changes (provider payloads, tool routing, memory handling) should include targeted tests.
- Avoid modifying prompt strings or timeouts unless fixing a documented bug.
