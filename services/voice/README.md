# 🎤 Sage Voice Service

<p align="center">
  <img src="https://img.shields.io/badge/Service-Local%20STT-2d5016?style=for-the-badge&labelColor=4a7c23" alt="Local STT Service" />
  <img src="https://img.shields.io/badge/Transport-HTTP-green?style=for-the-badge" alt="HTTP Service" />
</p>

<p align="center">
  <strong>Optional local speech-to-text service used by Sage voice features.</strong>
</p>

> [!NOTE]
> This service is optional. Sage core can run without it, but voice transcription requires it.

---

## 🧭 Quick Navigation

- [What It Does](#what-it-does)
- [Endpoints](#endpoints)
- [Run with Docker](#run-with-docker)
- [Configuration](#configuration)
- [Data and Cache](#data-and-cache)

---

<a id="what-it-does"></a>

## ✅ What It Does

- Provides local STT (speech-to-text) over HTTP.
- Transcribes Discord voice audio sent by Sage.
- Uses `faster-whisper` with the default model `deepdml/faster-whisper-large-v3-turbo-ct2`.

---

<a id="endpoints"></a>

## 🔌 Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health and model status |
| `POST` | `/v1/stt/transcribe` | WAV transcription (`multipart/form-data`, field: `audio`) |

---

<a id="run-with-docker"></a>

## 🚀 Run with Docker

From the repository root:

```bash
docker compose -f config/self-host/docker-compose.voice.yml up -d --build
```

Optional quick check:

```bash
curl -sS http://127.0.0.1:11333/health
```

---

<a id="configuration"></a>

## ⚙️ Configuration

Set these in your Sage environment:

```env
VOICE_SERVICE_BASE_URL=http://127.0.0.1:11333
VOICE_STT_ENABLED=true
```

---

<a id="data-and-cache"></a>

## 💾 Data and Cache

- First startup downloads model weights.
- Cache is persisted via Docker volume mount to:
  - `data/voice/models/`
- The same STT endpoint is used for:
  - voice-channel transcription while Sage is connected
  - optional Discord voice-message transcription in text channels
