import random
import math
from typing import Dict, Any

def run_profitability_simulation(
    unit_cost: float,
    mean_sale_price: float,
    price_std_dev: float,
    mean_demand: float,
    demand_std_dev: float,
    simulations_count: int = 1000
) -> Dict[str, Any]:
    """
    Executa simulacao de Monte Carlo para projetar receita, lucro e risco financeiro.
    Modela o preço de venda e a demanda com distribuicoes normais (Pure Python).
    """
    profits = []
    
    for _ in range(simulations_count):
        # Gerar amostra aleatoria normal de preco e demanda
        sale_price = random.gauss(mean_sale_price, price_std_dev)
        demand = max(0, int(random.gauss(mean_demand, demand_std_dev)))
        
        # Lucro = Demanda * (Preço de Venda - Custo Unitario)
        profit = demand * (sale_price - unit_cost)
        profits.append(profit)
        
    # Calcular estatísticas chave
    mean_profit = sum(profits) / simulations_count
    
    # Desvio padrao
    variance = sum((p - mean_profit) ** 2 for p in profits) / simulations_count
    std_profit = math.sqrt(variance)
    
    # Mediana
    sorted_profits = sorted(profits)
    median_profit = sorted_profits[simulations_count // 2]
    
    # Probabilidade de prejuizo (lucro < 0)
    loss_count = sum(1 for p in profits if p < 0)
    loss_prob = (loss_count / simulations_count) * 100
    
    # Value at Risk (VaR) a 95% de confianca (o pior cenario nos 5% piores casos)
    # 5% de 1000 iteracoes = index 50 na lista ordenada
    var_index = max(0, min(simulations_count - 1, int(0.05 * simulations_count)))
    var_95 = sorted_profits[var_index]
    
    return {
        "mean_profit": round(mean_profit, 2),
        "median_profit": round(median_profit, 2),
        "std_profit": round(std_profit, 2),
        "loss_probability": round(loss_prob, 2),
        "value_at_risk_95": round(var_95, 2)
    }
