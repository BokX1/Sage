# 🎤 Sage Voice Service (Local STT)

This is an optional local HTTP service used by Sage for:

- **STT (speech-to-text)**: transcribe Discord voice audio locally.

It is designed to be run via Docker Compose from the Sage repo.

## Endpoints

- `GET /health`
- `POST /v1/stt/transcribe` (multipart: `audio` = WAV)

## Run (Docker)

From the repo root:

```bash
docker compose -f config/self-host/docker-compose.voice.yml up -d --build
```

Then configure Sage:

```env
VOICE_SERVICE_BASE_URL=http://127.0.0.1:11333
VOICE_STT_ENABLED=true
```

## Notes

- First run will download model weights into `data/voice/models/` (mounted into the container).
- STT uses `faster-whisper` with the default model id `deepdml/faster-whisper-large-v3-turbo-ct2`.
- The same STT endpoint is used for both voice-channel transcription (when Sage is connected) and optional Discord voice-message transcription (audio attachments in text channels).
