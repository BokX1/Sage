# 🧾 Sage Changelog

<p align="center">
  <img src="https://img.shields.io/badge/Format-Keep%20a%20Changelog-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Keep a Changelog" />
  <img src="https://img.shields.io/badge/Versioning-SemVer-green?style=for-the-badge" alt="SemVer" />
</p>

<p align="center">
  <strong>All notable user-facing changes to Sage are tracked here.</strong>
</p>

> [!NOTE]
> This changelog format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 🧭 Quick Navigation

- [Unreleased](#unreleased)
- [1.0.0 (2026-02-28)](#v1-0-0)
- [Release Links](#release-links)

---

## [Unreleased]

### Added

- _No entries yet._

### Changed

- Refactored the onboarding welcome message (`src/bot/handlers/welcomeMessage.ts` and `src/bot/handlers/guildCreate.ts`) to use rich Discord Embeds.

### Fixed

- _No entries yet._

---

<a id="v1-0-0"></a>

## [1.0.0] - 2026-02-28

### Added

- Initial public release of Sage.
- Discord bot foundation with slash commands, interaction handlers, moderation and admin workflows, and operational scripts.
- Agent runtime with tool-call loop, context budgeting, prompt composition, evaluation scoring, telemetry, and replay harness support.
- Message awareness and memory stack, including transcript building, channel summaries, long-term compaction, and profile updates.
- Retrieval and embeddings capabilities for channel messages and file attachments.
- Voice pipeline support, including session tracking, transcription orchestration, overlap tracking, and dedicated voice service scaffolding.
- Social graph modules and integrations for ingestion, analytics, and query workflows.
- Comprehensive test suite (unit and integration) with CI workflows for lint, typecheck, tests, and supply-chain security controls.
- Project documentation across architecture, operations, configuration, security, and release process.

---

<a id="release-links"></a>

## 🔗 Release Links

[Unreleased]: https://github.com/BokX1/Sage/compare/ae988c1...HEAD
[1.0.0]: https://github.com/BokX1/Sage/commit/ae988c1
