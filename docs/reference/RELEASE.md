# 🚢 Release Process

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Release-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Release" />
</p>

This project follows **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`.

---

## 🧭 Quick Navigation

- [🧾 Changelog](#changelog)
- [✅ Local Baseline (Required)](#local-baseline-required)
- [🚀 Release Checklist](#release-checklist)
- [🔐 Supply Chain Artifacts](#supply-chain-artifacts)
- [🧪 CI-Style Local Rehearsal](#ci-style-local-rehearsal)
- [👀 PR Review Expectations](#pr-review-expectations)

---

<a id="changelog"></a>

## 🧾 Changelog

- Update `CHANGELOG.md` for every user-facing change.
- Group entries by version and date.
- Note database schema, config, or behavior changes.

---

<a id="local-baseline-required"></a>

## ✅ Local Baseline (Required)

All release work starts from the same baseline local gate:

```bash
npm run check:trust
```

`npm run check:trust` is the canonical local trust gate and does not require live API eval infrastructure.
It runs lint/typecheck, static test quality audit, and repeated/shuffled test validation.

---

<a id="release-checklist"></a>

## 🚀 Release Checklist

1. **Update version metadata**
   - `package.json`
   - `CHANGELOG.md`
2. **Run required validations**
   - `npm run check:trust`
   - `npm run build`
   - `npm run doctor`
   - `npm pack`
3. **Perform touched-scope cleanup**
   - code cleanup (dead code, duplication, unused imports/exports),
   - comment cleanup (remove stale/noise comments),
   - legacy/unneeded code or module cleanup.
4. **Review schema changes** (if applicable)
   - Document migration/rollback notes in `CHANGELOG.md` and ops docs.
5. **Review configuration changes**
   - Update [Configuration](CONFIGURATION.md) and setup docs for env var changes.
6. **Review dependency policy exceptions**
   - `prisma` and `@prisma/client` major updates are intentionally deferred from routine Dependabot groups.
   - Plan Prisma major upgrades as dedicated migration work (schema/client/runtime compatibility).
7. **Update related docs in `docs/`**
   - Align `docs/operations/` and `docs/reference/` with behavior, release, and runbook changes.
8. **Run release supply-chain workflow**
   - Execute `.github/workflows/release-supply-chain.yml` via `workflow_dispatch` or GitHub Release publish event.
   - Ensure package artifact, CycloneDX SBOM, and provenance attestation are generated.
9. **Tag and publish artifacts** (if applicable)

---

<a id="supply-chain-artifacts"></a>

## 🔐 Supply Chain Artifacts

Sage release hardening now produces:

1. **Package artifact**
   - Built via `npm pack` in the `Release Supply Chain` workflow.
2. **CycloneDX SBOM**
   - Generated with `npm sbom --sbom-format cyclonedx --omit=dev`.
3. **Build provenance attestation**
   - Generated via `actions/attest-build-provenance` for the built package artifact.

Code scanning and dependency-risk controls are also enforced in CI:

- `CodeQL / Analyze (javascript-typescript)`
- `dependency-review` (opt-in via repository variable `ENABLE_DEPENDENCY_REVIEW=true`; runs only when Dependency Graph is enabled, otherwise intentionally skipped with a notice)

If you enable dependency review, make sure repository Dependency Graph is enabled so the check runs instead of being skipped.

---

<a id="ci-style-local-rehearsal"></a>

## 🧪 CI-Style Local Rehearsal

```bash
npm ci
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/sage?schema=public npx prisma migrate deploy
NODE_ENV=test DISCORD_TOKEN=test-token DISCORD_APP_ID=test-app-id DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/sage?schema=public npm run check:trust
```

### Windows (PowerShell)

```powershell
npm ci
$env:NODE_ENV="test"
$env:DISCORD_TOKEN="test-token"
$env:DISCORD_APP_ID="test-app-id"
$env:DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/sage?schema=public"
npx prisma migrate deploy
npm run check:trust
```

---

<a id="pr-review-expectations"></a>

## 👀 PR Review Expectations

- PRs should include a concise summary, test results, and operational notes.
- Risky changes (provider payloads, tool execution, memory handling) should include targeted tests.
- PRs should remove touched-scope dead code and stale comments where safe, and note any deferred legacy cleanup in backlog.
- Avoid modifying prompt strings or timeouts unless fixing a documented bug.
