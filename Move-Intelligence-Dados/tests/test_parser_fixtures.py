"""Harness de fixtures reais dos parsers (F1.2, A2).

Cada fixture são dois arquivos em ``tests/fixtures/markdown/<fonte>/``:
``<nome>.md`` (markdown capturado de 1 página real, A1) + ``<nome>.json``
com todos os campos esperados de ``ParsedListing``. Fontes sem fixture
real (A1 com gaps: aliexpress, 1688, tiktok_shop) pulam com o motivo
explícito em vez de falhar.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.etl.extract.marketplace.parsers import PARSERS

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "markdown"


@pytest.mark.parametrize("source", sorted(PARSERS))
def test_parser_fixtures_reais(source: str):
    source_dir = FIXTURE_ROOT / source
    markdown_files = sorted(source_dir.glob("*.md")) if source_dir.exists() else []
    if not markdown_files:
        pytest.skip(f"sem fixtures reais de {source} (gap A1)")
    parse = PARSERS[source]
    for markdown_file in markdown_files:
        expected_file = markdown_file.with_suffix(".json")
        assert expected_file.exists(), f"falta o esperado de {markdown_file.name}"
        expected = json.loads(expected_file.read_text(encoding="utf-8"))
        parsed = parse(markdown_file.read_text(encoding="utf-8"))
        for field, value in expected.items():
            assert getattr(parsed, field) == value, f"{markdown_file.name}:{field}"
