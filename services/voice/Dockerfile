FROM python:3.11-slim

WORKDIR /app

# Needed for faster-whisper / ctranslate2: OpenMP runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  HF_HOME=/app/.cache/huggingface \
  XDG_CACHE_HOME=/app/.cache

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py

EXPOSE 11333
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "11333"]
