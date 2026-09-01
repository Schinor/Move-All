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
from typing import Dict, List, Tuple
import json
import sys

import numpy as np


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
    def __init__(self, vpl: np.ndarray, il: np.ndarray, roi: np.ndarray):
        self.vpl = vpl
        self.il = il
        self.roi = roi

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
        return (
            z_corr[0],
            z_corr[1],
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
        z_cambio, z_lead, z_preco, z_demanda = self._amostrar_choques(n_cenarios, rng)

        cambio = np.maximum(p.cambio_base * (1 + p.vol_cambio * z_cambio), 0.1)
        preco = np.maximum(p.preco_venda * (1 + p.vol_preco * z_preco), 1.0)
        lead = np.maximum(p.lead_time_dias * (1 + p.vol_lead * z_lead), 1.0)

        dem_esperada = p.demanda_referencia * (p.preco_referencia / preco) ** p.elasticidade
        demanda = np.maximum(dem_esperada * (1 + p.vol_demanda * z_demanda), 0.0)

        dem_planejada = p.demanda_referencia * (p.preco_referencia / p.preco_venda) ** p.elasticidade
        qty = np.round(dem_planejada * (1 + p.folga_estoque))

        custo_unit = p.custo_usd * cambio
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
        return ResultadoSimulacao(vpl, il, roi)

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


def risco(p_vpl_positivo: float) -> str:
    if p_vpl_positivo > 0.85:
        return "baixo"
    if p_vpl_positivo > 0.70:
        return "medio"
    return "alto"


def decisao(p_vpl_positivo: float) -> str:
    if p_vpl_positivo > 0.85:
        return "AVANCAR"
    if p_vpl_positivo > 0.70:
        return "AVANCAR COM RESSALVAS"
    return "REPROVAR"


def main():
    payload = json.load(sys.stdin)
    premissas = Premissas(**payload.get("premises", {}))
    scenario_count = int(payload.get("scenario_count") or 1000000)
    seed = payload.get("seed", 7)
    price_scan = bool(payload.get("price_scan", True))
    price_scan_scenarios = int(payload.get("price_scan_scenarios") or 4000)

    sim = SimuladorVPL(premissas)
    resultado = sim.simular(n_cenarios=scenario_count, semente=seed)
    metricas = resultado.metricas()
    risk_level = risco(metricas["p_vpl_positivo"])

    response = {
        "premises": premissas.__dict__,
        "metrics": metricas,
        "financial_score": round(metricas["p_vpl_positivo"] * 100),
        "risk_level": risk_level,
        "decision": decisao(metricas["p_vpl_positivo"]),
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
