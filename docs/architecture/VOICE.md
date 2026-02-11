# 🎤 Voice System

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
| **Voice Companion** | 🧪 Beta | Text-to-speech companion via `openai-audio` (BYOP required) |

> [!IMPORTANT]
> Sage does **not** listen to, record, or transcribe voice conversations. Voice Awareness only tracks **presence metadata** (join/leave events).

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

---

<a id="voice-features"></a>

## ✨ Voice Features

### Voice Awareness (Stable)

Sage can answer questions like:

- *"Who's in voice right now?"*
- *"How long has @User been in voice?"*
- *"Who was in #general-voice earlier today?"*

This works by injecting voice presence data into the LLM's context window via a **context provider**.

### Voice Companion (Beta)

When enabled, Sage can join a voice channel and respond with speech:

| Command | Action |
| :--- | :--- |
| `/join` | Join the user's current voice channel |
| `/leave` | Disconnect from voice |

> [!NOTE]
> Voice Companion requires a BYOP key with `openai-audio` support.

---

<a id="configuration"></a>

## ⚙️ Configuration

Voice does not currently expose dedicated `VOICE_*` environment variables.

Relevant runtime configuration comes from:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `LLM_API_KEY` | Global fallback key used for voice companion TTS when no guild BYOP key is set | *(empty)* |
| `CHAT_MODEL` | Base model setting for text routes (voice awareness context is injected into normal turns) | `openai-large` |
| `AUTOPILOT_MODE` | Controls when Sage replies in channels; voice companion join/leave remains command-driven | `manual` |

---

<a id="limitations"></a>

## ⚠️ Limitations

- Sage **cannot** transcribe or listen to voice conversations
- Voice Companion is **beta** and requires specific model support
- Join/leave are **command-driven only** (`/join`, `/leave`) — not exposed as runtime tools

---

## 🔗 Related Documentation

- [🎮 Commands Reference](../guides/COMMANDS.md#voice-commands-beta) — Voice slash commands
- [🔀 Runtime Pipeline](PIPELINE.md) — How voice context enters the pipeline
- [🧩 Model Reference](../reference/MODELS.md) — Audio model capabilities
