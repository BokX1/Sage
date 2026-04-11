"""GRU-based temporal memory updater for User nodes (TGN)."""

import json
import time
from typing import Any, Dict, List, Optional, Tuple

import mgp

MEMORY_DIM = 64
EVENT_DIM = 32
TIME_DIM = 16

_user_memory_store: Dict[str, Dict[str, Any]] = {}

_torch = None
_gru_cell = None
_event_encoder = None
_time_encoder = None

def _ensure_torch():
    global _torch, _gru_cell, _event_encoder, _time_encoder
    if _torch is not None:
        return
    import torch
    import torch.nn as nn
    _torch = torch

    _gru_cell = nn.GRUCell(input_size=EVENT_DIM + TIME_DIM, hidden_size=MEMORY_DIM)
    _gru_cell.eval()

    _event_encoder = nn.Sequential(
        nn.Linear(6, 16), nn.ReLU(), nn.Linear(16, EVENT_DIM), nn.Tanh(),
    )
    _event_encoder.eval()

    _time_encoder = nn.Linear(1, TIME_DIM)
    _time_encoder.eval()


def _encode_event_type(event_type: str) -> List[float]:
    mapping = {"MENTION": 0, "REPLY": 1, "REACT": 2, "VOICE_SESSION": 3}
    vec = [0.0] * 4
    vec[mapping.get(event_type, 0)] = 1.0
    return vec


def _encode_time_delta(delta_seconds: float) -> Any:
    _ensure_torch()
    import math
    normalized = math.log1p(max(0.0, delta_seconds)) / 20.0
    t = _torch.tensor([[normalized]], dtype=_torch.float32)
    with _torch.no_grad():
        return _time_encoder(t).squeeze(0)


def _encode_event(event_type: str, sentiment: float, duration_ms: float) -> Any:
    _ensure_torch()
    raw_features = _encode_event_type(event_type) + [sentiment, min(duration_ms / 3_600_000.0, 10.0)]
    x = _torch.tensor([raw_features], dtype=_torch.float32)
    with _torch.no_grad():
        return _event_encoder(x).squeeze(0)


def _get_memory(user_id: str) -> Any:
    _ensure_torch()
    if user_id in _user_memory_store:
        return _torch.tensor([_user_memory_store[user_id]["memory"]], dtype=_torch.float32)
    return _torch.zeros(1, MEMORY_DIM)


def _save_memory(user_id: str, memory_tensor: Any):
    _user_memory_store[user_id] = {
        "memory": memory_tensor.squeeze(0).tolist(),
        "last_updated": time.time(),
    }


@mgp.read_proc
def update_user_memory(
    ctx: mgp.ProcCtx,
    user_id: str,
) -> mgp.Record(memory_vector=mgp.List[float], updated_at=float):
    _ensure_torch()
    current_time = time.time()
    events: List[Dict[str, Any]] = []

    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                for edge in vertex.out_edges:
                    edge_type = str(edge.type)
                    if edge_type == "INTERACTED":
                        events.append({
                            "type": str(edge.properties.get("type", "MENTION")),
                            "sentiment": float(edge.properties.get("sentiment_score", 0.0)),
                            "ts": str(edge.properties.get("ts", "")),
                            "duration_ms": 0.0,
                        })
                    elif edge_type == "VOICE_SESSION":
                        events.append({
                            "type": "VOICE_SESSION",
                            "sentiment": 0.0,
                            "ts": str(edge.properties.get("ts", "")),
                            "duration_ms": float(edge.properties.get("duration_ms", 0)),
                        })
                break

    events.sort(key=lambda e: e["ts"])
    events = events[-50:]
    memory = _get_memory(user_id)

    for event in events:
        try:
            from datetime import datetime
            event_time = datetime.fromisoformat(event["ts"].replace("Z", "+00:00"))
            delta_seconds = max(0.0, current_time - event_time.timestamp())
        except (ValueError, TypeError):
            delta_seconds = 0.0

        event_vec = _encode_event(event["type"], event["sentiment"], event["duration_ms"])
        time_vec = _encode_time_delta(delta_seconds)
        gru_input = _torch.cat([event_vec, time_vec]).unsqueeze(0)

        with _torch.no_grad():
            memory = _gru_cell(gru_input, memory)

    _save_memory(user_id, memory)
    return mgp.Record(memory_vector=memory.squeeze(0).tolist(), updated_at=current_time)


@mgp.read_proc
def discord_get_user_memory(
    ctx: mgp.ProcCtx,
    user_id: str,
) -> mgp.Record(memory_vector=mgp.List[float], last_updated=mgp.Nullable[float]):
    _ensure_torch()
    if user_id in _user_memory_store:
        entry = _user_memory_store[user_id]
        return mgp.Record(memory_vector=entry["memory"], last_updated=entry["last_updated"])
    return mgp.Record(memory_vector=[0.0] * MEMORY_DIM, last_updated=None)


@mgp.read_proc
def batch_update_memories(
    ctx: mgp.ProcCtx,
    limit: int = 100,
) -> mgp.Record(updated_count=int, elapsed_ms=float):
    _ensure_torch()
    start = time.time()
    updated = 0

    user_ids: List[str] = []
    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            uid = str(vertex.properties.get("id", ""))
            if uid:
                user_ids.append(uid)
        if len(user_ids) >= limit:
            break

    for uid in user_ids:
        try:
            update_user_memory(ctx, uid)
            updated += 1
        except Exception:
            pass

    elapsed_ms = (time.time() - start) * 1000.0
    return mgp.Record(updated_count=updated, elapsed_ms=elapsed_ms)
