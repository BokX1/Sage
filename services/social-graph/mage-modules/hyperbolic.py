"""Poincaré ball hyperbolic embeddings for User nodes."""

import math
import time
from typing import Any, Dict, List, Optional

import mgp

POINCARE_DIM = 16
CURVATURE = -1.0
MAX_NORM = 1.0 - 1e-5
PAGERANK_WEIGHT = 1.0
INTERACTION_WEIGHT = 0.5

_embeddings: Dict[str, List[float]] = {}
_torch = None


def _ensure_torch():
    global _torch
    if _torch is not None:
        return
    import torch
    _torch = torch


def _clamp_norm(x):
    norm = _torch.norm(x, dim=-1, keepdim=True)
    clamped_norm = _torch.clamp(norm, max=MAX_NORM)
    return x * (clamped_norm / _torch.clamp(norm, min=1e-8))


def _mobius_add(x, y):
    c = abs(CURVATURE)
    x_sq = _torch.sum(x * x, dim=-1, keepdim=True)
    y_sq = _torch.sum(y * y, dim=-1, keepdim=True)
    xy = _torch.sum(x * y, dim=-1, keepdim=True)

    num = (1 + 2 * c * xy + c * y_sq) * x + (1 - c * x_sq) * y
    denom = 1 + 2 * c * xy + c * c * x_sq * y_sq
    denom = _torch.clamp(denom, min=1e-8)
    return _clamp_norm(num / denom)


def _exp_map_zero(v):
    norm = _torch.norm(v, dim=-1, keepdim=True)
    norm = _torch.clamp(norm, min=1e-8)
    return _clamp_norm(_torch.tanh(norm) * v / norm)


def _hyperbolic_distance(x, y):
    diff = x - y
    diff_sq = _torch.sum(diff * diff, dim=-1, keepdim=True)
    x_sq = _torch.sum(x * x, dim=-1, keepdim=True)
    y_sq = _torch.sum(y * y, dim=-1, keepdim=True)

    denom = (1 - x_sq) * (1 - y_sq)
    denom = _torch.clamp(denom, min=1e-8)
    arg = 1 + 2 * diff_sq / denom
    arg = _torch.clamp(arg, min=1.0 + 1e-8)
    return _torch.acosh(arg)


def _compute_initial_position(pagerank: float, interaction_count: int) -> List[float]:
    _ensure_torch()
    radius = 1.0 - math.tanh(pagerank * PAGERANK_WEIGHT * 100.0 + 0.01)
    radius = max(0.01, min(radius, MAX_NORM))

    import hashlib
    seed_bytes = hashlib.sha256(f"{pagerank:.6f}:{interaction_count}".encode()).digest()
    gen = _torch.Generator()
    gen.manual_seed(int.from_bytes(seed_bytes[:4], 'big'))

    direction = _torch.randn(POINCARE_DIM, generator=gen)
    direction = direction / _torch.norm(direction).clamp(min=1e-8)
    position = _clamp_norm((direction * radius).unsqueeze(0)).squeeze(0)
    return position.tolist()


@mgp.read_proc
def embed_user(
    ctx: mgp.ProcCtx,
    user_id: str,
) -> mgp.Record(position=mgp.List[float], distance_from_origin=float):
    _ensure_torch()
    pagerank = 0.0
    interaction_count = 0

    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                pagerank = float(vertex.properties.get("pagerank", 0.0))
                for edge in vertex.out_edges:
                    if str(edge.type) in ("INTERACTED", "VOICE_SESSION"):
                        interaction_count += 1
                break

    position = _compute_initial_position(pagerank, interaction_count)
    _embeddings[user_id] = position
    dist = float(_torch.norm(_torch.tensor(position, dtype=_torch.float32)).item())
    return mgp.Record(position=position, distance_from_origin=dist)


@mgp.read_proc
def compute_distance(
    ctx: mgp.ProcCtx,
    user_a: str,
    user_b: str,
) -> mgp.Record(distance=float, a_origin_dist=float, b_origin_dist=float):
    _ensure_torch()
    if user_a not in _embeddings:
        embed_user(ctx, user_a)
    if user_b not in _embeddings:
        embed_user(ctx, user_b)

    a = _torch.tensor([_embeddings.get(user_a, [0.0] * POINCARE_DIM)], dtype=_torch.float32)
    b = _torch.tensor([_embeddings.get(user_b, [0.0] * POINCARE_DIM)], dtype=_torch.float32)

    return mgp.Record(
        distance=float(_hyperbolic_distance(a, b).item()),
        a_origin_dist=float(_torch.norm(a).item()),
        b_origin_dist=float(_torch.norm(b).item()),
    )


@mgp.read_proc
def batch_embed(
    ctx: mgp.ProcCtx,
    limit: int = 100,
) -> mgp.Record(updated_count=int, elapsed_ms=float):
    _ensure_torch()
    start = time.time()
    updated = 0

    for vertex in ctx.graph.vertices:
        if updated >= limit:
            break
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            uid = str(vertex.properties.get("id", ""))
            if uid:
                try:
                    embed_user(ctx, uid)
                    updated += 1
                except Exception:
                    pass

    elapsed_ms = (time.time() - start) * 1000.0
    return mgp.Record(updated_count=updated, elapsed_ms=elapsed_ms)
