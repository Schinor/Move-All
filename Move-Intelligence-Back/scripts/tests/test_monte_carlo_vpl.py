"""Testes do runner Monte Carlo VPL (F2.3).

- Determinismo com seed.
- Crescimento 0 == comportamento anterior (payload sem os campos novos gera
  exatamente a mesma resposta que com zeros explícitos).
- Crescimento positivo aumenta P(VPL>0) com o resto igual.
- CNY × câmbio == USD equivalente.
- Validação rejeita entradas inválidas com erro JSON claro.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "monte-carlo-vpl.py"


def run_script(payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=300,
    )


def base_payload(**overrides) -> dict:
    premises = {"crescimento_demanda_mensal": 0.0, "vol_crescimento": 0.0}
    premises.update(overrides.pop("premises", {}))
    payload = {"premises": premises, "scenario_count": 2000, "seed": 7, "price_scan": False}
    payload.update(overrides)
    return payload


def test_deterministico_com_seed():
    first = json.loads(run_script(base_payload()).stdout)
    second = json.loads(run_script(base_payload()).stdout)
    assert first["metrics"] == second["metrics"]
    assert first["premises_hash"] == second["premises_hash"]


def test_crescimento_zero_preserva_comportamento():
    explicit = run_script(base_payload())
    legacy = run_script({"scenario_count": 2000, "seed": 7, "price_scan": False})
    assert explicit.returncode == 0
    assert legacy.returncode == 0
    assert json.loads(explicit.stdout) == json.loads(legacy.stdout)


def test_crescimento_positivo_aumenta_p_vpl_positivo():
    flat = json.loads(run_script(base_payload()).stdout)
    growing = json.loads(
        run_script(base_payload(premises={"crescimento_demanda_mensal": 0.03})).stdout
    )
    assert 0.0 < flat["metrics"]["p_vpl_positivo"] < 1.0
    assert growing["metrics"]["p_vpl_positivo"] > flat["metrics"]["p_vpl_positivo"]


def test_moeda_cny_equivale_a_usd():
    em_usd = json.loads(
        run_script(base_payload(premises={"custo_usd": 14.0})).stdout
    )
    em_cny = json.loads(
        run_script(
            base_payload(premises={"custo_usd": 100.0, "moeda_custo": "CNY", "cambio_cny_usd": 0.14})
        ).stdout
    )
    # 100 × 0.14 tem poeira float (14.000000000000002): compara com tolerância.
    for key in ("p_vpl_positivo", "vpl_mediano", "vpl_medio", "cvar_5"):
        assert em_usd["metrics"][key] == em_cny["metrics"][key] or abs(
            em_usd["metrics"][key] - em_cny["metrics"][key]
        ) < 1e-6


def test_validacao_rejeita_entrada_invalida_com_erro_json():
    bad = run_script(base_payload(premises={"preco_venda": "caro"}))
    assert bad.returncode != 0
    assert "error" in json.loads(bad.stdout)

    negative = run_script(base_payload(premises={"vol_crescimento": -1.0}))
    assert negative.returncode != 0
    assert "error" in json.loads(negative.stdout)


def test_resposta_traz_hash_e_versao():
    response = json.loads(run_script(base_payload()).stdout)
    assert response["data_version"] == "premises@1"
    assert len(response["premises_hash"]) == 64


def test_moq_zero_preserva_resposta_anterior():
    legado = run_script(base_payload())
    com_zero = run_script(base_payload(premises={"qtd_minima_pedido": 0}))
    assert legado.returncode == 0 and com_zero.returncode == 0
    assert json.loads(legado.stdout) == json.loads(com_zero.stdout)
    assert "qtd_minima_pedido" not in json.loads(legado.stdout)["premises"]


def test_moq_alto_aumenta_capital_e_reduz_vpl():
    base = json.loads(run_script(base_payload()).stdout)
    alto = json.loads(run_script(base_payload(premises={"qtd_minima_pedido": 50000})).stdout)
    assert alto["capital_primeiro_pedido"] > base["capital_primeiro_pedido"]
    assert alto["metrics"]["vpl_mediano"] < base["metrics"]["vpl_mediano"]
    assert alto["premises"]["qtd_minima_pedido"] == 50000


def test_capital_primeiro_pedido_presente_e_positivo():
    resposta = json.loads(run_script(base_payload()).stdout)
    assert resposta["capital_primeiro_pedido"] > 0


def test_moq_negativo_e_rejeitado():
    resultado = run_script(base_payload(premises={"qtd_minima_pedido": -1}))
    assert resultado.returncode == 1
    assert "qtd_minima_pedido" in json.loads(resultado.stdout)["error"]
