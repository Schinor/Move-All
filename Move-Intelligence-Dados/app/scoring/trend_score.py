from typing import List, Dict

def calculate_trend_score(interest_data: List[Dict]) -> float:
    """
    Calcula um score de tendencia de 0 a 100 baseando-se no momentum dos dados.
    Usa regressao linear simples nos valores de interesse do Google Trends (Pure Python).
    """
    if not interest_data or len(interest_data) < 2:
        return 50.0 # Score neutro padrão se nao houver dados suficientes
        
    y = [float(item.get("value", 50)) for item in interest_data]
    n = len(y)
    x = list(range(n))
    
    # Executa ajuste linear simples (y = slope * x + intercept)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xx = sum(xi * xi for xi in x)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    
    denominator = (n * sum_xx - sum_x * sum_x)
    if denominator == 0:
        slope = 0.0
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denominator
    
    # Escalonamento simples para score
    raw_score = 50.0 + (slope * 8.0)
    
    # Forca limites entre 0 e 100
    normalized_score = max(0.0, min(100.0, raw_score))
    
    return round(normalized_score, 2)
