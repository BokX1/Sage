import io
import os
import tempfile
import wave
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

APP_TITLE = "sage-voice-service"

STT_MODEL_ID = os.getenv("VOICE_STT_MODEL_ID", "deepdml/faster-whisper-large-v3-turbo-ct2").strip()
STT_COMPUTE_TYPE = os.getenv("VOICE_STT_COMPUTE_TYPE", "int8").strip()

app = FastAPI(title=APP_TITLE)

_stt_model: Optional[WhisperModel] = None


def _get_stt_model() -> WhisperModel:
    global _stt_model
    if _stt_model is None:
        if not STT_MODEL_ID:
            raise RuntimeError("VOICE_STT_MODEL_ID must not be empty")
        # CPU-only by design (Sage host selects CPU-only for this service).
        _stt_model = WhisperModel(STT_MODEL_ID, device="cpu", compute_type=STT_COMPUTE_TYPE)
    return _stt_model


def _wav_duration_ms(wav_bytes: bytes) -> int:
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                return 0
            return int(frames / rate * 1000)
    except Exception:
        return 0


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "service": APP_TITLE,
            "stt": {
                "modelId": STT_MODEL_ID,
                "computeType": STT_COMPUTE_TYPE,
                "loaded": _stt_model is not None,
            },
        }
    )


@app.post("/v1/stt/transcribe")
async def stt_transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    prompt: Optional[str] = Form(default=None),
) -> JSONResponse:
    if audio.content_type and audio.content_type not in ("audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"):
        # We keep this strict because Sage sends WAV.
        raise HTTPException(status_code=415, detail=f"Unsupported content-type: {audio.content_type}")

    wav_bytes = await audio.read()
    if not wav_bytes:
        raise HTTPException(status_code=400, detail="Empty audio payload")

    model = _get_stt_model()

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(wav_bytes)
            tmp_path = tmp.name

        segments, info = model.transcribe(
            tmp_path,
            vad_filter=True,
            language=language,
            initial_prompt=prompt,
        )

        seg_list = []
        text_parts = []
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            text_parts.append(text)
            seg_list.append(
                {
                    "startMs": int(seg.start * 1000),
                    "endMs": int(seg.end * 1000),
                    "text": text,
                }
            )

        text = " ".join(text_parts).strip()
        return JSONResponse(
            {
                "text": text,
                "language": getattr(info, "language", None),
                "segments": seg_list,
                "durationMs": _wav_duration_ms(wav_bytes),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT failed: {e}") from e
    finally:
        try:
            if tmp_path:
                os.unlink(tmp_path)
        except Exception:
            pass
