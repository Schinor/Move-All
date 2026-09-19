"""Recorte da página para a ficha (subprojeto A, spec 5.1)."""
from pathlib import Path

import pytest

from app.etl.extract.marketplace.parsers.base import build_page_excerpt

FIXTURES = Path(__file__).parent / "fixtures" / "markdown"
SOURCES = ["amazon", "amazon_br", "mercado_livre", "shopee_br", "alibaba"]


@pytest.mark.parametrize("source", SOURCES)
def test_excerpt_das_paginas_reais(source):
    markdown = (FIXTURES / source / "product-01.md").read_text(encoding="utf-8")
    excerpt = build_page_excerpt(markdown, title="Título do anúncio")
    assert excerpt.startswith("Título do anúncio")
    assert len(excerpt) <= 4000
    assert "![" not in excerpt
    assert "](http" not in excerpt


def test_usa_json_ld_e_bloco_de_especificacoes():
    markdown = (
        "# Bike Spinning X\n"
        '```json\n{"@type": "Product", "name": "Bike Spinning X", "brand": {"name": "Marca"}, '
        '"description": "Roda de inércia de 13 kg e resistência magnética."}\n```\n'
        "## Características\n- Roda de inércia: 13 kg\n- Carga máxima: 120 kg\n"
        "## Avaliações\nMuito boa\n"
    )
    excerpt = build_page_excerpt(markdown, title="Bike Spinning X")
    assert "Marca" in excerpt
    assert "Roda de inércia: 13 kg" in excerpt
    assert "Muito boa" not in excerpt


def test_sem_markdown_retorna_so_o_titulo():
    assert build_page_excerpt("", title="Só título") == "Só título"
