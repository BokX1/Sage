"""Global multi-head self-attention over all User nodes (Graph Transformer)."""

import math
import time
from typing import Any, Dict, List, Optional, Tuple

import mgp

HIDDEN_DIM = 64
NUM_HEADS = 4
HEAD_DIM = HIDDEN_DIM // NUM_HEADS
FF_DIM = 128

_representations: Dict[str, List[float]] = {}
_torch = None
_q_proj = None
_k_proj = None
_v_proj = None
_out_proj = None
_ff_net = None
_layer_norm1 = None
_layer_norm2 = None


def _ensure_torch():
    global _torch, _q_proj, _k_proj, _v_proj, _out_proj, _ff_net
    global _layer_norm1, _layer_norm2
    if _torch is not None:
        return
    import torch
    import torch.nn as nn
    _torch = torch

    _q_proj = nn.Linear(HIDDEN_DIM, HIDDEN_DIM, bias=False)
    _k_proj = nn.Linear(HIDDEN_DIM, HIDDEN_DIM, bias=False)
    _v_proj = nn.Linear(HIDDEN_DIM, HIDDEN_DIM, bias=False)
    _out_proj = nn.Linear(HIDDEN_DIM, HIDDEN_DIM, bias=False)

    _ff_net = nn.Sequential(
        nn.Linear(HIDDEN_DIM, FF_DIM), nn.GELU(), nn.Linear(FF_DIM, HIDDEN_DIM),
    )

    _layer_norm1 = nn.LayerNorm(HIDDEN_DIM)
    _layer_norm2 = nn.LayerNorm(HIDDEN_DIM)

    for module in [_q_proj, _k_proj, _v_proj, _out_proj, _ff_net, _layer_norm1, _layer_norm2]:
        module.eval()


def _build_node_features(vertex) -> List[float]:
    pagerank = float(vertex.properties.get("pagerank", 0.0))
    community = float(vertex.properties.get("community_id", 0))
    community_norm = (community % 100) / 100.0

    out_count = sum(1 for _ in vertex.out_edges)
    in_count = sum(1 for _ in vertex.in_edges)

    sentiments = []
    for edge in vertex.out_edges:
        s = edge.properties.get("sentiment_score")
        if s is not None:
            sentiments.append(float(s))
    avg_sentiment = sum(sentiments) / max(len(sentiments), 1)
    sentiment_var = 0.0
    if len(sentiments) > 1:
        sentiment_var = sum((s - avg_sentiment) ** 2 for s in sentiments) / len(sentiments)

    features = [
        pagerank, community_norm,
        min(out_count / 100.0, 1.0), min(in_count / 100.0, 1.0),
        avg_sentiment, sentiment_var,
        min(out_count + in_count, 500) / 500.0,
        1.0 if pagerank > 0.01 else 0.0,
    ]

    if len(features) < HIDDEN_DIM:
        features.extend([0.0] * (HIDDEN_DIM - len(features)))
    return features[:HIDDEN_DIM]


def _multi_head_attention(x):
    _ensure_torch()
    N = x.shape[0]

    with _torch.no_grad():
        Q = _q_proj(x).view(N, NUM_HEADS, HEAD_DIM).transpose(0, 1)
        K = _k_proj(x).view(N, NUM_HEADS, HEAD_DIM).transpose(0, 1)
        V = _v_proj(x).view(N, NUM_HEADS, HEAD_DIM).transpose(0, 1)

        scale = math.sqrt(HEAD_DIM)
        scores = _torch.bmm(Q, K.transpose(1, 2)) / scale
        attn_weights = _torch.softmax(scores, dim=-1)
        attended = _torch.bmm(attn_weights, V)
        attended = attended.transpose(0, 1).contiguous().view(N, HIDDEN_DIM)
        output = _out_proj(attended)

    return output, attn_weights


def _transformer_block(x):
    _ensure_torch()
    with _torch.no_grad():
        normed = _layer_norm1(x)
        attended, attn_weights = _multi_head_attention(normed)
        x = x + attended

        normed = _layer_norm2(x)
        x = x + _ff_net(normed)

    return x, attn_weights


@mgp.read_proc
def compute_global_attention(
    ctx: mgp.ProcCtx,
    limit: int = 100,
) -> mgp.Record(updated_count=int, elapsed_ms=float):
    _ensure_torch()
    start = time.time()

    user_ids: List[str] = []
    user_features: List[List[float]] = []

    for vertex in ctx.graph.vertices:
        if len(user_ids) >= limit:
            break
        if vertex.labels and "User" in [str(l) for l in vertex.labels]:
            uid = str(vertex.properties.get("id", ""))
            if uid:
                user_ids.append(uid)
                user_features.append(_build_node_features(vertex))

    if not user_ids:
        return mgp.Record(updated_count=0, elapsed_ms=(time.time() - start) * 1000.0)

    x = _torch.tensor(user_features, dtype=_torch.float32)
    transformed, _attn = _transformer_block(x)

    for i, uid in enumerate(user_ids):
        _representations[uid] = transformed[i].tolist()

    return mgp.Record(updated_count=len(user_ids), elapsed_ms=(time.time() - start) * 1000.0)


@mgp.read_proc
def get_cross_clique_influence(
    ctx: mgp.ProcCtx,
    user_a: str,
    user_b: str,
) -> mgp.Record(influence_score=float, shared_attention_heads=int):
    _ensure_torch()

    rep_a = _representations.get(user_a)
    rep_b = _representations.get(user_b)
    if rep_a is None or rep_b is None:
        return mgp.Record(influence_score=0.0, shared_attention_heads=0)

    a = _torch.tensor(rep_a, dtype=_torch.float32)
    b = _torch.tensor(rep_b, dtype=_torch.float32)

    cos_sim = float(_torch.dot(a, b) / (
        _torch.norm(a).clamp(min=1e-8) * _torch.norm(b).clamp(min=1e-8)
    ))

    shared = 0
    for h in range(NUM_HEADS):
        s, e = h * HEAD_DIM, (h + 1) * HEAD_DIM
        head_a, head_b = a[s:e], b[s:e]
        head_sim = float(_torch.dot(head_a, head_b) / (
            _torch.norm(head_a).clamp(min=1e-8) * _torch.norm(head_b).clamp(min=1e-8)
        ))
        if head_sim > 0.3:
            shared += 1

    return mgp.Record(influence_score=cos_sim, shared_attention_heads=shared)
