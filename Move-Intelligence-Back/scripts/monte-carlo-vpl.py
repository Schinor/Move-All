"""
Runner JSON do simulador Monte Carlo + VPL.

Recebe no stdin:
{
  "premises": { ... },
  "scenario_count": 1000000,
  "seed": 7,
  "price_scan": true,
  "price_scan_scenarios": 4000
}

Retorna JSON no stdout. Sem input interativo e sem gráficos.
"""

from dataclasses import dataclass, replace
from typing import Dict, List, Mapping, Tuple
import hashlib
import json
import math
import sys

import numpy as np


DATA_VERSION = "premises@1"
COST_CURRENCIES = ("USD", "CNY")


@dataclass
class Premissas:
    preco_venda: float = 209.0
    tma_mensal: float = 0.015
    folga_estoque: float = 0.05
    horizonte_meses: int = 6

    preco_referencia: float = 199.0
    demanda_referencia: float = 520.0
    elasticidade: float = 2.5

    custo_usd: float = 14.0
    frete_usd_unidade: float = 3.0
    imposto_importacao: float = 0.35
    cambio_base: float = 5.0
    marketing_inicial: float = 5000.0
    # Moeda do custo (F2.3): 'USD' usa custo_usd direto; 'CNY' converte por
    # cambio_cny_usd. Default preserva o comportamento anterior.
    moeda_custo: str = "USD"
    cambio_cny_usd: float = 1.0

    comissao_marketplace: float = 0.16
    imposto_venda: float = 0.08
    frete_cliente: float = 8.0
    custo_fixo_mensal: float = 500.0

    lead_time_dias: float = 35.0
    fracao_salvage: float = 0.45
    curva_rampa: Tuple[float, ...] = (0.05, 0.12, 0.22, 0.26, 0.21, 0.14)

    vol_cambio: float = 0.06
    vol_preco: float = 0.05
    vol_demanda: float = 0.15
    vol_lead: float = 0.20
    corr_cambio_lead: float = 0.35
    # Crescimento da demanda (F2.3): demanda do mês m = dem × exp((g + σg·z)·m)
    # antes da curva de rampa. Zero por padrão (resultado idêntico ao anterior).
    crescimento_demanda_mensal: float = 0.0
    vol_crescimento: float = 0.0

    def __post_init__(self):
        h = int(max(1, self.horizonte_meses))
        self.horizonte_meses = h
        rampa = list(self.curva_rampa)
        if not rampa:
            rampa = [1.0]
        if len(rampa) < h:
            rampa = rampa + [rampa[-1]] * (h - len(rampa))
        elif len(rampa) > h:
            rampa = rampa[:h]
        self.curva_rampa = tuple(float(v) for v in rampa)


class ResultadoSimulacao:
    def __init__(self, vpl: np.ndarray, il: np.ndarray, roi: np.ndarray, choques=None):
        self.vpl = vpl
        self.il = il
        self.roi = roi
        # Choques amostrados por fator (B4): {cambio, lead_time, preco, demanda, crescimento}
        self.choques = choques or {}

    def metricas(self) -> Dict[str, float]:
        v = np.sort(self.vpl)
        n = len(v)
        n_cauda = max(1, int(0.05 * n))
        return {
            "cenarios": int(n),
            "p_vpl_positivo": float((self.vpl > 0).mean()),
            "vpl_medio": float(self.vpl.mean()),
            "vpl_mediano": float(np.median(self.vpl)),
            "vpl_p5": float(np.percentile(self.vpl, 5)),
            "vpl_p95": float(np.percentile(self.vpl, 95)),
            "cvar_5": float(v[:n_cauda].mean()),
            "il_mediano": float(np.median(self.il)),
            "roi_medio": float(self.roi.mean()),
        }

    def histograma(self, bins: int = 30) -> List[Dict[str, float]]:
        counts, edges = np.histogram(self.vpl, bins=bins)
        return [
            {"min": float(edges[i]), "max": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(len(counts))
        ]


class SimuladorVPL:
    def __init__(self, premissas: Premissas):
        self.p = premissas

    def _amostrar_choques(self, n: int, rng: np.random.Generator):
        rho = float(np.clip(self.p.corr_cambio_lead, -0.999, 0.999))
        corr = np.array([[1.0, rho], [rho, 1.0]])
        l = np.linalg.cholesky(corr)
        z = rng.standard_normal((2, n))
        z_corr = l @ z
        # z_crescimento SEMPRE por último: com crescimento zerado, os sorteios
        # anteriores (e o resultado) são idênticos aos da versão anterior.
        return (
            z_corr[0],
            z_corr[1],
            rng.standard_normal(n),
            rng.standard_normal(n),
            rng.standard_normal(n),
        )

    def _fatores_desconto(self):
        i = self.p.tma_mensal
        h = self.p.horizonte_meses
        rampa = np.array(self.p.curva_rampa)
        disc = np.zeros(h)

        for lead_m in range(h):
            ativos = h - lead_m
            w = rampa[:ativos]
            ws = w.sum() or 1.0
            disc[lead_m] = sum(
                (w[m] / ws) / (1 + i) ** (lead_m + m + 1) for m in range(ativos)
            )

        fixo_vp = sum(self.p.custo_fixo_mensal / (1 + i) ** t for t in range(1, h + 1))
        salv_vp = 1 / (1 + i) ** h
        return disc, fixo_vp, salv_vp

    def simular(self, n_cenarios: int = 1000000, semente: int | None = None) -> ResultadoSimulacao:
        p = self.p
        rng = np.random.default_rng(semente)
        z_cambio, z_lead, z_preco, z_demanda, z_crescimento = self._amostrar_choques(n_cenarios, rng)

        cambio = np.maximum(p.cambio_base * (1 + p.vol_cambio * z_cambio), 0.1)
        preco = np.maximum(p.preco_venda * (1 + p.vol_preco * z_preco), 1.0)
        lead = np.maximum(p.lead_time_dias * (1 + p.vol_lead * z_lead), 1.0)

        dem_esperada = p.demanda_referencia * (p.preco_referencia / preco) ** p.elasticidade
        # Crescimento mensal antes da rampa: mês m pesa dem × exp((g + σg·z)·m).
        # Atalho exato com g = σg = 0: resultado bit-idêntico à versão anterior.
        if p.crescimento_demanda_mensal == 0 and p.vol_crescimento == 0:
            dem_crescimento = dem_esperada
        else:
            meses = np.arange(1, p.horizonte_meses + 1)
            rampa = np.array(p.curva_rampa)
            participacao = rampa / (rampa.sum() or 1.0)
            fator_mes = np.exp(
                (p.crescimento_demanda_mensal + p.vol_crescimento * z_crescimento)[:, None]
                * meses[None, :]
            )
            dem_crescimento = dem_esperada * (fator_mes * participacao[None, :]).sum(axis=1)
        demanda = np.maximum(dem_crescimento * (1 + p.vol_demanda * z_demanda), 0.0)

        dem_planejada = p.demanda_referencia * (p.preco_referencia / p.preco_venda) ** p.elasticidade
        qty = np.round(dem_planejada * (1 + p.folga_estoque))

        custo_usd_efetivo = p.custo_usd * (p.cambio_cny_usd if p.moeda_custo == "CNY" else 1.0)
        custo_unit = custo_usd_efetivo * cambio
        landed = custo_unit * (1 + p.imposto_importacao) + p.frete_usd_unidade * cambio
        investimento_inicial = qty * landed + p.marketing_inicial

        vendidas = np.minimum(demanda, qty)
        net_unit = preco * (1 - p.comissao_marketplace - p.imposto_venda) - p.frete_cliente

        lead_meses = np.minimum(p.horizonte_meses - 1, np.floor(lead / 30).astype(int))
        disc, fixo_vp, salv_vp = self._fatores_desconto()

        pv_vendas = vendidas * net_unit * disc[lead_meses]
        pv_salvage = (qty - vendidas) * custo_unit * p.fracao_salvage * salv_vp
        pv_inflows = pv_vendas - fixo_vp + pv_salvage

        vpl = -investimento_inicial + pv_inflows
        il = pv_inflows / investimento_inicial
        roi = vpl / investimento_inicial
        choques = {
            "cambio": z_cambio,
            "lead_time": z_lead,
            "preco": z_preco,
            "demanda": z_demanda,
            "crescimento": z_crescimento,
        }
        return ResultadoSimulacao(vpl, il, roi, choques)

    def preco_otimo(self, faixa, passo: int, n_cenarios: int, semente: int):
        curva: List[Tuple[float, float]] = []
        melhor = None
        for preco in range(int(faixa[0]), int(faixa[1]) + 1, max(1, passo)):
            res = SimuladorVPL(replace(self.p, preco_venda=float(preco))).simular(
                n_cenarios=n_cenarios,
                semente=semente,
            )
            vpl_med = float(np.median(res.vpl))
            curva.append((float(preco), vpl_med))
            if melhor is None or vpl_med > melhor[1]:
                melhor = (float(preco), vpl_med)
        return melhor, curva


NUMERIC_PREMISES = (
    "preco_venda", "tma_mensal", "folga_estoque", "preco_referencia",
    "demanda_referencia", "elasticidade", "custo_usd", "frete_usd_unidade",
    "imposto_importacao", "cambio_base", "marketing_inicial",
    "comissao_marketplace", "imposto_venda", "frete_cliente",
    "custo_fixo_mensal", "lead_time_dias", "fracao_salvage", "vol_cambio",
    "vol_preco", "vol_demanda", "vol_lead", "corr_cambio_lead",
    "cambio_cny_usd", "crescimento_demanda_mensal", "vol_crescimento",
)


def validar_premissas(premissas: Premissas) -> None:
    """Validação de entradas com erro claro (sem NaN/negativos inválidos)."""
    for campo in NUMERIC_PREMISES:
        valor = getattr(premissas, campo)
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            raise ValueError(f"Premissa {campo!r} precisa ser numérica (recebido {valor!r})")
        if not math.isfinite(valor):
            raise ValueError(f"Premissa {campo!r} inválida (NaN ou infinita)")
    for campo in (
        "preco_venda", "preco_referencia", "demanda_referencia", "custo_usd",
        "cambio_base", "cambio_cny_usd", "vol_crescimento",
    ):
        if getattr(premissas, campo) < 0:
            raise ValueError(f"Premissa {campo!r} não pode ser negativa")
    if premissas.moeda_custo not in COST_CURRENCIES:
        raise ValueError(f"moeda_custo precisa ser uma de {COST_CURRENCIES}")
    if premissas.horizonte_meses < 1:
        raise ValueError("horizonte_meses precisa ser >= 1")


def premises_dict(premissas: Premissas) -> Dict[str, object]:
    """Premissas efetivas como dict JSON-estável (listas, sem tuplas)."""
    data = dict(premissas.__dict__)
    data["curva_rampa"] = list(premissas.curva_rampa)
    return data


def premises_hash(payload: Mapping[str, object] | Dict[str, object]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    ).hexdigest()


def _rank(a: np.ndarray) -> np.ndarray:
    order = np.argsort(a, kind="mergesort")
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(len(a), dtype=float)
    # Média de empates: implementa rank médio sem scipy.
    _, inv, counts = np.unique(a, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=ranks)
    avg = sums / counts
    return avg[inv]


def _spearman(x: np.ndarray, y: np.ndarray) -> float:
    if len(x) < 3 or len(y) < 3 or len(x) != len(y):
        return 0.0
    rx = _rank(x.astype(float))
    ry = _rank(y.astype(float))
    rx = rx - rx.mean()
    ry = ry - ry.mean()
    denom = float(np.sqrt((rx * rx).sum() * (ry * ry).sum()))
    if not (denom > 0) or not math.isfinite(denom):
        return 0.0
    corr = float((rx * ry).sum() / denom)
    return corr if math.isfinite(corr) else 0.0


def risk_drivers(vpl: np.ndarray, choques: Dict[str, np.ndarray]) -> List[Dict[str, object]]:
    """B4: contribuição de cada choque para a variância do VPL.

    Correlação de Spearman ao quadrado, normalizada para somar 100%.
    Campos adicionais — com a mesma seed, as métricas não mudam.
    """
    scores: Dict[str, float] = {}
    for factor in ("cambio", "lead_time", "preco", "demanda", "crescimento"):
        z = choques.get(factor)
        if z is None:
            scores[factor] = 0.0
            continue
        try:
            corr = _spearman(np.asarray(z).ravel(), np.asarray(vpl).ravel())
            scores[factor] = corr * corr
        except Exception:
            scores[factor] = 0.0
    total = sum(scores.values())
    if not (total > 0):
        return [{"factor": k, "share": 0.0} for k in ("cambio", "lead_time", "preco", "demanda", "crescimento")]
    return [
        {"factor": k, "share": round(scores[k] / total * 100, 1)}
        for k in ("cambio", "lead_time", "preco", "demanda", "crescimento")
    ]


def main():
    try:
        payload = json.load(sys.stdin)
        premissas = Premissas(**payload.get("premises", {}))
        validar_premissas(premissas)
        scenario_count = int(payload.get("scenario_count") or 1000000)
        if scenario_count < 100:
            raise ValueError("scenario_count precisa ser >= 100")
        seed = payload.get("seed", 7)
        price_scan = bool(payload.get("price_scan", True))
        price_scan_scenarios = int(payload.get("price_scan_scenarios") or 4000)
        data_version = str(payload.get("data_version") or DATA_VERSION)
    except Exception as error:
        print(json.dumps({"error": f"Entrada inválida: {error}"}, ensure_ascii=False))
        sys.exit(1)
        return

    try:
        sim = SimuladorVPL(premissas)
        resultado = sim.simular(n_cenarios=scenario_count, semente=seed)
        metricas = resultado.metricas()
    except Exception as error:
        print(json.dumps({"error": f"Falha na simulação: {error}"}, ensure_ascii=False))
        sys.exit(1)
        return

    effective = premises_dict(premissas)
    try:
        drivers = risk_drivers(resultado.vpl, resultado.choques)
    except Exception:
        drivers = []
    response = {
        "premises": effective,
        "premises_hash": premises_hash(effective),
        "data_version": data_version,
        "metrics": metricas,
        # B1: Move Score = P(VPL>0)*100. Faixa (green/yellow/red, 70/50) é
        # aplicada no backend via business-rules (nunca 85/70 aqui).
        "financial_score": round(metricas["p_vpl_positivo"] * 100),
        # B4: contribuição de cada choque para a variância do VPL (adicional;
        # com a mesma seed, as métricas não mudam).
        "risk_drivers": drivers,
        "histogram": resultado.histograma(),
        "price_curve": [],
        "optimal_price": None,
    }

    if price_scan:
        faixa = (
            max(1, round(premissas.preco_venda * 0.5)),
            round(premissas.preco_venda * 2),
        )
        passo = max(1, round((faixa[1] - faixa[0]) / 70))
        melhor, curva = sim.preco_otimo(
            faixa=faixa,
            passo=passo,
            n_cenarios=price_scan_scenarios,
            semente=int(seed or 7),
        )
        response["price_curve"] = [
            {"price": preco, "median_vpl": vpl_mediano} for preco, vpl_mediano in curva
        ]
        response["optimal_price"] = {
            "price": melhor[0],
            "median_vpl": melhor[1],
        } if melhor else None

    print(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
