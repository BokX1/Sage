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
- Note any migrations, configuration changes, or breaking behavior.

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
   - `npm pack`

3. **Review database migrations** (if applicable)
   - Document required steps in `CHANGELOG.md` and/or docs.

4. **Confirm configuration changes**
   - If you add/remove env vars, update [Configuration](CONFIGURATION.md) and any setup docs.

5. **Tag the release** and publish artifacts (if applicable)

---

<a id="run-locally-like-ci"></a>

## 🧪 Run locally like CI

```bash
npm ci
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=file:./test.db npm run release:check
```

### Windows (PowerShell)

```powershell
npm ci
$env:NODE_ENV="test"
$env:DISCORD_TOKEN="test-token"
$env:DISCORD_APP_ID="test-app-id"
$env:DATABASE_URL="file:./test.db"
npm run release:check
```

---

<a id="release-readiness-check-recommended"></a>

## 🔍 Release readiness check (recommended)

```bash
npm run release:check
```

---

<a id="pr-review-expectations"></a>

## 👀 PR review expectations

- PRs should include a concise summary, test results, and operational notes.
- Risky changes (provider payloads, tool routing, memory handling) should include targeted tests.
- Avoid modifying prompt strings or timeouts unless fixing a documented bug.
