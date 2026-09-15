"""Regra de fornecedor de alto volume (A6)."""

from app.pipelines.supplier_sourcing import detected_sources, select_top_supplier


def test_maior_volume_vence():
    top = select_top_supplier(
        [
            {"source": "alibaba", "native_supplier_id": "s1", "sold": 100},
            {"source": "1688", "native_supplier_id": "s2", "sold": 900},
            {"source": "1688", "native_supplier_id": "s2", "sold": 100},
        ]
    )

    assert top is not None
    assert (top["source"], top["native_supplier_id"]) == ("1688", "s2")


def test_volume_decide_quando_ninguem_atinge_a_presenca():
    top = select_top_supplier(
        [
            {"source": "alibaba", "native_supplier_id": "s1", "sold": 5000},
            {"source": "1688", "native_supplier_id": "s2", "sold": None},
            {"source": "aliexpress", "native_supplier_id": "s3", "sold": None},
        ],
        min_listings=2,
    )

    # Ninguém em 2+ anúncios: vence a maior soma (s1).
    assert top is not None
    assert top["native_supplier_id"] == "s1"


def test_presenca_minima_com_volume_zero_mas_n_anuncios():
    top = select_top_supplier(
        [
            {"source": "1688", "native_supplier_id": "s2", "sold": None},
            {"source": "1688", "native_supplier_id": "s2", "sold": None},
            {"source": "alibaba", "native_supplier_id": "s1", "sold": 10},
        ],
        min_listings=2,
    )

    assert top is not None
    assert top["native_supplier_id"] == "s2"
    assert "2 anúncios" in str(top["reason"])


def test_sem_fornecedor_identificado_nao_inventa():
    assert select_top_supplier([]) is None
    assert select_top_supplier([{"source": "", "native_supplier_id": "", "sold": 5}]) is None
    assert select_top_supplier([{"source": "alibaba", "native_supplier_id": "s1", "sold": None}]) is None


def test_detected_sources_lista_fontes_observadas():
    assert detected_sources(
        [
            {"source": "amazon_br"},
            {"source": "alibaba"},
            {"source": "amazon_br"},
            {"source": ""},
        ]
    ) == ["alibaba", "amazon_br"]
