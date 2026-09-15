"""Decisão de amostragem de avaliações (A5).

Nova amostra de textos só quando `reviews_count` cresceu ≥ 10 avaliações OU
≥ 10% desde a última amostra (limiares configuráveis por env). Sem nomes de
quem avaliou em nenhum ponto: só estrelas, texto, idioma e ID na fonte.
"""

from __future__ import annotations

import os
from typing import Optional


def _int_env(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def min_new_reviews() -> int:
    """Novas avaliações absolutas que disparam reamostragem (default 10)."""
    return _int_env("REVIEW_SAMPLE_MIN_NEW", 10)


def min_growth_pct() -> float:
    """Crescimento percentual que dispara reamostragem (default 10.0)."""
    return _float_env("REVIEW_SAMPLE_MIN_PCT", 10.0)


def samples_per_band() -> int:
    """Amostras por faixa 1–2/3/4–5 (default 10)."""
    return _int_env("REVIEW_SAMPLES_PER_BAND", 10)


def should_collect_samples(
    *,
    reviews_count: Optional[int],
    reviews_count_at_sample: Optional[int],
    min_new: Optional[int] = None,
    min_pct: Optional[float] = None,
) -> bool:
    """Nova amostra só com crescimento real desde a última.

    Sem contagem atual ou zerada: não amostra. Nunca amostrado antes: amostra
    (estabelece a base `reviews_count_at_sample`).
    """
    if reviews_count is None or reviews_count <= 0:
        return False
    if reviews_count_at_sample is None:
        return True
    threshold_new = min_new if min_new is not None else min_new_reviews()
    threshold_pct = min_pct if min_pct is not None else min_growth_pct()
    growth = reviews_count - reviews_count_at_sample
    if growth >= threshold_new:
        return True
    if reviews_count_at_sample > 0:
        pct = (growth / reviews_count_at_sample) * 100.0
        if pct >= threshold_pct:
            return True
    return False


def review_band(stars: Optional[int]) -> Optional[str]:
    """Faixa do resumo (B5): 1–2 baixo, 3 neutro, 4–5 alto."""
    if stars is None:
        return None
    if stars <= 2:
        return "low"
    if stars == 3:
        return "mid"
    if stars >= 4:
        return "high"
    return None


__all__ = [
    "min_growth_pct",
    "min_new_reviews",
    "review_band",
    "samples_per_band",
    "should_collect_samples",
]
