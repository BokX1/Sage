"""Per-type heterogeneous graph attention over interaction edges."""

import time
from typing import Any, Dict, List, Tuple

import mgp

EMBED_DIM = 32
NUM_EDGE_TYPES = 4
OUTPUT_DIM = 64

EDGE_TYPE_INDEX = {"MENTION": 0, "REPLY": 1, "REACT": 2, "VOICE_SESSION": 3}

_torch = None
_attention_heads = None
_fusion_layer = None


def _ensure_torch():
    global _torch, _attention_heads, _fusion_layer
    if _torch is not None:
        return
    import torch
    import torch.nn as nn
    _torch = torch

    _attention_heads = nn.ModuleList([
        nn.Sequential(nn.Linear(12, EMBED_DIM), nn.LeakyReLU(0.2), nn.Linear(EMBED_DIM, 1))
        for _ in range(NUM_EDGE_TYPES)
    ])

    _fusion_layer = nn.Sequential(
        nn.Linear(NUM_EDGE_TYPES * 6, OUTPUT_DIM), nn.ReLU(),
        nn.Linear(OUTPUT_DIM, OUTPUT_DIM), nn.Tanh(),
    )

    _attention_heads.eval()
    _fusion_layer.eval()


def _get_user_features(vertex) -> List[float]:
    pagerank = float(vertex.properties.get("pagerank", 0.0))
    community = float(vertex.properties.get("community_id", 0))
    community_norm = (community % 100) / 100.0

    out_count = 0
    in_count = 0
    sentiment_sum = 0.0
    sentiment_count = 0

    for edge in vertex.out_edges:
        out_count += 1
        s = edge.properties.get("sentiment_score")
        if s is not None:
            sentiment_sum += float(s)
            sentiment_count += 1

    for edge in vertex.in_edges:
        in_count += 1

    return [
        pagerank, community_norm,
        min(out_count / 100.0, 1.0), min(in_count / 100.0, 1.0),
        sentiment_sum / max(sentiment_count, 1), 0.0,
    ]


def _collect_neighbors(vertex) -> Dict[str, List[Tuple[Any, List[float]]]]:
    neighbors: Dict[str, List[Tuple[Any, List[float]]]] = {
        "MENTION": [], "REPLY": [], "REACT": [], "VOICE_SESSION": [],
    }

    for edge in vertex.out_edges:
        edge_type_str = str(edge.type)
        if edge_type_str == "INTERACTED":
            sub_type = str(edge.properties.get("type", "MENTION"))
            if sub_type in neighbors:
                neighbors[sub_type].append((edge.to_vertex, [
                    float(edge.properties.get("sentiment_score", 0.0)),
                ]))
        elif edge_type_str == "VOICE_SESSION":
            duration_hours = min(float(edge.properties.get("duration_ms", 0)) / 3_600_000.0, 10.0)
            neighbors["VOICE_SESSION"].append((edge.to_vertex, [duration_hours]))

    return neighbors


@mgp.read_proc
def compute_attention(
    ctx: mgp.ProcCtx,
    user_id: str,
) -> mgp.Record(neighbor_id=str, attention_weight=float, edge_type=str):
    _ensure_torch()

    source_vertex = None
    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                source_vertex = vertex
                break

    if source_vertex is None:
        return mgp.Record(neighbor_id="", attention_weight=0.0, edge_type="")

    source_features = _get_user_features(source_vertex)
    neighbors = _collect_neighbors(source_vertex)

    all_records = []
    for edge_type, neighbor_list in neighbors.items():
        if not neighbor_list:
            continue

        attn_head = _attention_heads[EDGE_TYPE_INDEX[edge_type]]
        scores = []
        neighbor_ids = []

        for target_vertex, _edge_feats in neighbor_list:
            target_id = str(target_vertex.properties.get("id", ""))
            combined = source_features + _get_user_features(target_vertex)
            x = _torch.tensor([combined], dtype=_torch.float32)
            with _torch.no_grad():
                scores.append(attn_head(x).item())
            neighbor_ids.append(target_id)

        if scores:
            weights = _torch.softmax(_torch.tensor(scores, dtype=_torch.float32), dim=0)
            for i, nid in enumerate(neighbor_ids):
                all_records.append((nid, float(weights[i].item()), edge_type))

    if not all_records:
        return mgp.Record(neighbor_id="", attention_weight=0.0, edge_type="NONE")

    best = max(all_records, key=lambda r: r[1])
    return mgp.Record(neighbor_id=best[0], attention_weight=best[1], edge_type=best[2])


@mgp.read_proc
def get_user_representation(
    ctx: mgp.ProcCtx,
    user_id: str,
) -> mgp.Record(representation=mgp.List[float], dominant_signal_type=str):
    _ensure_torch()

    source_vertex = None
    for vertex in ctx.graph.vertices:
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            if str(vertex.properties.get("id", "")) == user_id:
                source_vertex = vertex
                break

    if source_vertex is None:
        return mgp.Record(representation=[0.0] * OUTPUT_DIM, dominant_signal_type="NONE")

    source_features = _get_user_features(source_vertex)
    neighbors = _collect_neighbors(source_vertex)

    type_representations = []
    type_magnitudes = {}

    for edge_type in ["MENTION", "REPLY", "REACT", "VOICE_SESSION"]:
        neighbor_list = neighbors[edge_type]
        if not neighbor_list:
            type_representations.append(_torch.zeros(6))
            type_magnitudes[edge_type] = 0.0
            continue

        attn_head = _attention_heads[EDGE_TYPE_INDEX[edge_type]]
        all_target_features = []
        scores = []

        for target_vertex, _edge_feats in neighbor_list:
            target_features = _get_user_features(target_vertex)
            all_target_features.append(target_features)
            combined = source_features + target_features
            x = _torch.tensor([combined], dtype=_torch.float32)
            with _torch.no_grad():
                scores.append(attn_head(x).item())

        weights = _torch.softmax(_torch.tensor(scores, dtype=_torch.float32), dim=0)
        feat_tensor = _torch.tensor(all_target_features, dtype=_torch.float32)
        weighted = (weights.unsqueeze(1) * feat_tensor).sum(dim=0)
        type_representations.append(weighted)
        type_magnitudes[edge_type] = float(weights.max().item())

    fused_input = _torch.cat(type_representations).unsqueeze(0)
    with _torch.no_grad():
        representation = _fusion_layer(fused_input).squeeze(0)

    dominant = max(type_magnitudes, key=lambda k: type_magnitudes[k])
    return mgp.Record(
        representation=representation.tolist(),
        dominant_signal_type=dominant if type_magnitudes[dominant] > 0 else "NONE",
    )


@mgp.read_proc
def batch_compute(
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
                    get_user_representation(ctx, uid)
                    updated += 1
                except Exception:
                    pass

    elapsed_ms = (time.time() - start) * 1000.0
    return mgp.Record(updated_count=updated, elapsed_ms=elapsed_ms)
