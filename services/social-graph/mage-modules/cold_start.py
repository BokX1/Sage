"""Cold-start inductive bootstrap for new users with sparse interaction history."""

import math
import time
from typing import Any, Dict, List, Optional

import mgp

REPR_DIM = 64
METADATA_DIM = 8
COLD_START_THRESHOLD = 3
ARCHETYPE_COUNT = 4
ARCHETYPE_NAMES = ["lurker", "casual", "active", "leader"]

_archetype_centroids: Dict[str, List[float]] = {}
_bootstrap_cache: Dict[str, Dict[str, Any]] = {}
_torch = None
_metadata_encoder = None
_induction_layer = None


def _ensure_torch():
    global _torch, _metadata_encoder, _induction_layer
    if _torch is not None:
        return
    import torch
    import torch.nn as nn
    _torch = torch

    _metadata_encoder = nn.Sequential(
        nn.Linear(METADATA_DIM, 32), nn.ReLU(), nn.Linear(32, REPR_DIM), nn.Tanh(),
    )
    _metadata_encoder.eval()

    _induction_layer = nn.Sequential(
        nn.Linear(REPR_DIM * 2, REPR_DIM), nn.ReLU(), nn.Linear(REPR_DIM, REPR_DIM), nn.Tanh(),
    )
    _induction_layer.eval()


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _encode_metadata(metadata: Dict[str, Any]) -> List[float]:
    return [
        _clamp01(float(metadata.get("account_age_days", 0)) / 1825.0),
        _clamp01(float(metadata.get("join_recency_days", 0)) / 365.0),
        1.0 if metadata.get("is_bot", False) else 0.0,
        1.0 if metadata.get("has_avatar", True) else 0.0,
        1.0 if metadata.get("has_roles", False) else 0.0,
        _clamp01(float(metadata.get("channel_count", 0)) / 50.0),
        _clamp01(float(metadata.get("first_message_delay_hours", 0)) / 168.0),
        _clamp01(float(metadata.get("display_name_length", 0)) / 32.0),
    ]


def _get_neighbor_mean(ctx, user_id: str) -> Optional[List[float]]:
    _ensure_torch()
    neighbor_features: List[List[float]] = []

    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                for edge in vertex.out_edges:
                    target = edge.to_vertex
                    if target.labels and "User" in [str(l) for l in target.labels]:
                        pagerank = float(target.properties.get("pagerank", 0.0))
                        community = float(target.properties.get("community_id", 0))
                        out_count = sum(1 for _ in target.out_edges)
                        feats = [pagerank, (community % 100) / 100.0, min(out_count / 100.0, 1.0)]
                        feats.extend([0.0] * (REPR_DIM - len(feats)))
                        neighbor_features.append(feats[:REPR_DIM])
                break

    if not neighbor_features:
        return None

    t = _torch.tensor(neighbor_features, dtype=_torch.float32)
    return t.mean(dim=0).tolist()


def _match_archetype(representation: List[float]) -> str:
    if not _archetype_centroids:
        return "unknown"
    _ensure_torch()
    rep = _torch.tensor(representation, dtype=_torch.float32)

    best_name = "unknown"
    best_sim = -2.0
    for name, centroid_list in _archetype_centroids.items():
        centroid = _torch.tensor(centroid_list, dtype=_torch.float32)
        sim = float(_torch.dot(rep, centroid) / (
            _torch.norm(rep).clamp(min=1e-8) * _torch.norm(centroid).clamp(min=1e-8)
        ))
        if sim > best_sim:
            best_sim = sim
            best_name = name
    return best_name


@mgp.read_proc
def bootstrap_user(
    ctx: mgp.ProcCtx,
    user_id: str,
    account_age_days: float = 0.0,
    join_recency_days: float = 0.0,
    is_bot: bool = False,
    has_avatar: bool = True,
    has_roles: bool = False,
    channel_count: int = 0,
    first_message_delay_hours: float = 0.0,
    display_name_length: int = 0,
) -> mgp.Record(
    representation=mgp.List[float],
    confidence=float,
    matched_archetype=str,
    is_cold_start=bool,
):
    _ensure_torch()

    edge_count = 0
    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                edge_count = sum(1 for _ in vertex.out_edges)
                break

    is_cold = edge_count < COLD_START_THRESHOLD

    if not is_cold:
        return mgp.Record(
            representation=[0.0] * REPR_DIM, confidence=0.8,
            matched_archetype="established", is_cold_start=False,
        )

    metadata = {
        "account_age_days": account_age_days, "join_recency_days": join_recency_days,
        "is_bot": is_bot, "has_avatar": has_avatar, "has_roles": has_roles,
        "channel_count": channel_count, "first_message_delay_hours": first_message_delay_hours,
        "display_name_length": display_name_length,
    }
    x = _torch.tensor([_encode_metadata(metadata)], dtype=_torch.float32)
    with _torch.no_grad():
        metadata_emb = _metadata_encoder(x).squeeze(0)

    confidence = 0.2
    neighbor_mean = _get_neighbor_mean(ctx, user_id)
    if neighbor_mean is not None:
        neighbor_tensor = _torch.tensor(neighbor_mean, dtype=_torch.float32)
        combined = _torch.cat([metadata_emb, neighbor_tensor]).unsqueeze(0)
        with _torch.no_grad():
            representation = _induction_layer(combined).squeeze(0)
        confidence = min(0.2 + edge_count * 0.15, 0.6)
    else:
        representation = metadata_emb

    rep_list = representation.tolist()
    archetype = _match_archetype(rep_list)

    _bootstrap_cache[user_id] = {
        "representation": rep_list, "confidence": confidence, "archetype": archetype,
    }

    return mgp.Record(
        representation=rep_list, confidence=confidence,
        matched_archetype=archetype, is_cold_start=True,
    )


@mgp.read_proc
def compute_archetypes(
    ctx: mgp.ProcCtx,
    sample_limit: int = 50,
) -> mgp.Record(archetype_count=int, elapsed_ms=float):
    _ensure_torch()
    start = time.time()

    users: List[Dict[str, Any]] = []
    for vertex in ctx.graph.vertices:
        if len(users) >= sample_limit:
            break
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            uid = str(vertex.properties.get("id", ""))
            if not uid:
                continue
            pagerank = float(vertex.properties.get("pagerank", 0.0))
            out_count = sum(1 for _ in vertex.out_edges)
            in_count = sum(1 for _ in vertex.in_edges)
            users.append({
                "id": uid, "pagerank": pagerank,
                "out_count": out_count, "in_count": in_count,
                "total": out_count + in_count,
            })

    if not users:
        return mgp.Record(archetype_count=0, elapsed_ms=(time.time() - start) * 1000.0)

    archetypes: Dict[str, List[Dict[str, Any]]] = {name: [] for name in ARCHETYPE_NAMES}
    for user in users:
        pr, total = user["pagerank"], user["total"]
        out_ratio = user["out_count"] / max(total, 1)
        if pr > 0.01 and user["in_count"] > 5:
            archetypes["leader"].append(user)
        elif total > 10 and out_ratio > 0.4:
            archetypes["active"].append(user)
        elif total > 2:
            archetypes["casual"].append(user)
        else:
            archetypes["lurker"].append(user)

    for name, members in archetypes.items():
        if not members:
            _archetype_centroids[name] = [0.0] * REPR_DIM
            continue
        encoded = []
        for member in members:
            features = _encode_metadata({
                "account_age_days": 365, "join_recency_days": 30,
                "is_bot": False, "has_avatar": True,
                "has_roles": member["total"] > 5,
                "channel_count": min(member["total"], 50),
                "first_message_delay_hours": 1, "display_name_length": 10,
            })
            x = _torch.tensor([features], dtype=_torch.float32)
            with _torch.no_grad():
                encoded.append(_metadata_encoder(x).squeeze(0))
        _archetype_centroids[name] = _torch.stack(encoded).mean(dim=0).tolist()

    return mgp.Record(
        archetype_count=len([n for n in archetypes if archetypes[n]]),
        elapsed_ms=(time.time() - start) * 1000.0,
    )
