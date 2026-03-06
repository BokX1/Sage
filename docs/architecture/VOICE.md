# 🎤 Voice System

<p align="center">
  <img src="https://img.shields.io/badge/%F0%9F%8C%BF-Sage%20Voice-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Sage Voice" />
</p>

How Sage interacts with Discord voice channels.

---

## 🧭 Quick navigation

- [Overview](#overview)
- [Architecture](#architecture)
- [Voice Features](#voice-features)
- [Configuration](#configuration)
- [Limitations](#limitations)

---

<a id="overview"></a>

## 🌐 Overview

Sage has two voice-related capabilities:

| Feature | Status | Description |
| :--- | :--- | :--- |
| **Voice Awareness** | ✅ Stable | Tracks who is in voice, how long they've been there, and overlap data |
| **Voice Transcription** | 🧪 Beta | Optional local STT while Sage is in-channel, with summary-only memory on leave |

> [!IMPORTANT]
> By default, Sage does **not** listen to, record, or transcribe voice conversations. If you enable voice transcription (`VOICE_STT_ENABLED=true`) Sage will transcribe in-channel audio while connected, keep utterances in-memory, and persist **summary-only** memory when the session ends.

---

<a id="architecture"></a>

## 🏗️ Architecture

```mermaid
flowchart TD
    classDef discord fill:#5865f2,stroke:#333,color:white
    classDef tracker fill:#e8f5e9,stroke:#333,color:black
    classDef output fill:#fff3cd,stroke:#333,color:black

    V[Discord Voice Events]:::discord --> VT[Voice Tracker]:::tracker
    VT --> VP[Voice Presence Index]:::tracker
    VT --> VS[Voice Session Repo]:::tracker
    VT --> VO[Voice Overlap Tracker]:::tracker

    VP --> VQ[Voice Queries]:::tracker
    VS --> VQ
    VO --> VQ

    VQ --> VF[Voice Format]:::output
    VF --> CP[Context Provider]:::output
    CP --> LLM[LLM Context]:::output

    VA[Discord Voice Audio]:::discord --> VM[Voice Manager]:::tracker
    VM --> STT[Voice Transcription Manager]:::tracker
    STT --> VSV[Local Voice Service (STT)]:::tracker
    STT --> VCS[In-memory Voice Session Store]:::tracker
    VCS --> VSUM[Voice Session Summarizer]:::output
    VSUM --> VDB[(VoiceConversationSummary)]:::output
```

### Key Components

| Component | File | Purpose |
| :--- | :--- | :--- |
| Voice Manager | `voiceManager.ts` | Discord voice channel join/leave via slash commands |
| Voice Tracker | `voiceTracker.ts` | Tracks join/leave events and session durations |
| Presence Index | `voicePresenceIndex.ts` | Real-time snapshot of who is in which channel |
| Session Repo | `voiceSessionRepo.ts` | Persistence layer for voice session data |
| Overlap Tracker | `voiceOverlapTracker.ts` | Tracks simultaneous presence between users |
| Voice Queries | `voiceQueries.ts` | Query interface for voice data |
| Voice Format | `voiceFormat.ts` | Formats voice data into natural language for LLM context |
| Voice Service Client | `voiceServiceClient.ts` | HTTP client for local STT |
| Transcription Manager | `voiceTranscriptionManager.ts` | Subscribes to Discord audio, chunks utterances, calls local STT |
| Session Store | `voiceConversationSessionStore.ts` | In-memory utterance store + live context formatting |
| Summary Repo | `voiceConversationSummaryRepo.ts` | Persists summary-only voice session memory |
| Session Summarizer | `voiceSessionSummarizer.ts` | Generates structured summaries from utterance transcripts |
| Local Voice Service | `services/voice/` | Dockerized FastAPI service providing local STT |

---

<a id="voice-features"></a>

## ✨ Voice Features

### Voice Awareness (Stable)

Sage can answer questions like:

- *"Who's in voice right now?"*
- *"How long has @User been in voice?"*
- *"Who was in #general-voice earlier today?"*

When Sage is actively in a voice session, it can inject a compact live voice context block into the prompt. Outside of those sessions, voice analytics are fetched on demand through the `discord` tool.

### Voice Transcription + Summary Memory (Beta)

When enabled, Sage can transcribe in-channel voice audio while connected and use it as short-lived context:

| Command | Action |
| :--- | :--- |
| `/join` | Join the user's current voice channel |
| `/leave` | Disconnect from voice |

Operational behavior:

- Join/leave is **command-driven**.
- Audio is transcribed locally (STT) and kept **in-memory only**.
- A small "live voice context" window can be injected into chat turns while in voice.
- When Sage leaves voice, it can persist a **summary-only** record to the database (`VoiceConversationSummary`).

> [!IMPORTANT]
> Voice transcription is gated by channel logging policy: it only runs when `isLoggingEnabled(guildId, voiceChannelId)` is true (ingestion allowlist/blocklist).

---

<a id="configuration"></a>

## ⚙️ Configuration

Voice exposes dedicated `VOICE_*` environment variables (see `docs/reference/CONFIGURATION.md` for the full list).

Key settings:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VOICE_SERVICE_BASE_URL` | Base URL for local voice service | `http://127.0.0.1:11333` |
| `VOICE_STT_ENABLED` | Enable in-channel voice transcription (STT) | `false` |
| `VOICE_SESSION_SUMMARY_ENABLED` | Persist summary-only voice session memory on leave | `true` |

To run the local voice service:

```bash
docker compose -f config/services/self-host/docker-compose.voice.yml up -d --build
```

---

<a id="limitations"></a>

## ⚠️ Limitations

- Sage does not respond to voice input directly (no wake-word-in-voice).
- Voice transcription is best-effort and is disabled by default.
- Only **summary-only** voice memory is persisted; raw voice transcripts are not stored in the database.
- Join/leave are **command-driven only** (`/join`, `/leave`) and are not exposed as runtime tools.

---

## 🔗 Related Documentation

- [🎮 Commands Reference](../guides/COMMANDS.md#public-commands) — Voice slash commands
- [🔀 Runtime Pipeline](PIPELINE.md) — How voice context enters the pipeline
- [⚙️ Configuration](../reference/CONFIGURATION.md) — Voice environment variables
