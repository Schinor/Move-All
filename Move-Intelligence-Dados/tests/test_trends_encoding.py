"""Subprojeto D: acentos do radar (SSE sem charset) e conserto das linhas gravadas."""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path

from app.etl.extract.marketplace.common import BrightDataClient
from app.etl.load.database import SearchTrendSnapshotModel, get_session

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_trends_encoding.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("repair_trends_encoding", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeSseResponse:
    """Imita o requests: com decode_unicode, decodifica com `self.encoding`."""

    def __init__(self, payload: str):
        self.headers = {"content-type": "text/event-stream"}
        self.encoding = "ISO-8859-1"
        self._raw = ("event: message\ndata: " + payload + "\n\n").encode("utf-8")

    def iter_lines(self, decode_unicode=False):
        for line in self._raw.split(b"\n"):
            yield line.decode(self.encoding) if decode_unicode and self.encoding else line

    def close(self):
        pass


def test_sse_sem_charset_mantem_acentos():
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "tapete de acupressão"}]}},
        ensure_ascii=False,
    )
    decoded = BrightDataClient._decode_mcp_response(FakeSseResponse(payload))
    assert decoded["result"]["content"][0]["text"] == "tapete de acupressão"


def test_repair_text_conserta_e_preserva():
    script = _load_script()
    quebrado = "tapete de acupressão".encode("utf-8").decode("latin-1")
    assert quebrado == "tapete de acupressÃ£o"
    assert script.repair_text(quebrado) == "tapete de acupressão"
    assert script.repair_text("sem acento") == "sem acento"
    # "Ã" legítimo que não é UTF-8 quebrado: mantém o original.
    assert script.repair_text("SÃO") == "SÃO"
    assert script.repair_value([{"query": quebrado, "value": 50}]) == [{"query": "tapete de acupressão", "value": 50}]


def test_run_dry_run_nao_grava_e_apply_grava(tmp_path):
    script = _load_script()
    database_url = f"sqlite:///{tmp_path / 'trends.db'}"
    quebrado = "tapete de acupressão".encode("utf-8").decode("latin-1")
    db = get_session(database_url)
    try:
        row_id = str(uuid.uuid4())
        db.add(SearchTrendSnapshotModel(
            id=row_id, type_key="acupressure_mat", term="tapete de acupressão", geo="BR",
            timeframe="today 12-m", status="ok", points=[],
            related_top=[{"query": quebrado, "value": 100}],
            related_rising=[{"query": quebrado, "value": 50, "label": "+50%", "breakout": False}],
        ))
        db.commit()
    finally:
        db.close()

    assert script.run(database_url=database_url, apply=False) == {"inspected": 1, "changed": 1, "applied": 0}
    db = get_session(database_url)
    try:
        assert db.get(SearchTrendSnapshotModel, row_id).related_rising[0]["query"] == quebrado
    finally:
        db.close()

    assert script.run(database_url=database_url, apply=True) == {"inspected": 1, "changed": 1, "applied": 1}
    db = get_session(database_url)
    try:
        row = db.get(SearchTrendSnapshotModel, row_id)
        assert row.related_rising[0]["query"] == "tapete de acupressão"
        assert row.related_top[0]["query"] == "tapete de acupressão"
    finally:
        db.close()
