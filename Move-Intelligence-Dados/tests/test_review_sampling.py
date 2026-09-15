"""Regra de amostragem de avaliações (A5)."""

from app.pipelines.review_sampling import (
    review_band,
    should_collect_samples,
)


def test_primeira_amostra_estabelece_a_base():
    assert should_collect_samples(reviews_count=25, reviews_count_at_sample=None)


def test_sem_crescimento_nao_reamostra():
    assert not should_collect_samples(reviews_count=100, reviews_count_at_sample=100)
    assert not should_collect_samples(reviews_count=105, reviews_count_at_sample=100)


def test_dez_novas_ou_dez_porcento_reamostram():
    assert should_collect_samples(reviews_count=110, reviews_count_at_sample=100)
    assert should_collect_samples(reviews_count=109, reviews_count_at_sample=99)
    # +9 em 100 (+9%): abaixo dos dois limiares.
    assert not should_collect_samples(reviews_count=109, reviews_count_at_sample=100)
    # +5 em 20 (+25%): passa pelo percentual.
    assert should_collect_samples(reviews_count=25, reviews_count_at_sample=20)


def test_sem_contagem_nao_amostra():
    assert not should_collect_samples(reviews_count=None, reviews_count_at_sample=10)
    assert not should_collect_samples(reviews_count=0, reviews_count_at_sample=None)


def test_faixas_para_o_resumo():
    assert review_band(1) == "low"
    assert review_band(2) == "low"
    assert review_band(3) == "mid"
    assert review_band(4) == "high"
    assert review_band(5) == "high"
    assert review_band(None) is None
