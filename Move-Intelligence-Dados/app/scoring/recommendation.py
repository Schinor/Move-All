from typing import Dict, Any

def generate_recommendation(
    trend_score: float,
    financial_score: float,
    loss_probability: float
) -> Dict[str, Any]:
    """
    Consolida as analises de tendencia e financeira para gerar recomendacao final de compra.
    Retorna o status ('Comprar', 'Observar', 'Descartar') e a justificativa comercial.
    """
    # Score ponderado final (60% financeiro, 40% tendencia)
    combined_score = (financial_score * 0.6) + (trend_score * 0.4)
    
    # Regra de decisao inicial
    if combined_score >= 70.0 and loss_probability < 15.0:
        decision = "Comprar"
        reason = (f"Forte viabilidade financeira (score: {financial_score:.1f}) e tendencia de alta "
                  f"(score: {trend_score:.1f}) com baixa probabilidade de perda ({loss_probability:.1f}%).")
    elif combined_score >= 45.0 and loss_probability < 30.0:
        decision = "Observar"
        reason = (f"Desempenho moderado (score combinado: {combined_score:.1f}). Sugere-se acompanhar "
                  f"evolucao de precos e demanda antes de efetuar pedidos.")
    else:
        decision = "Descartar"
        reason = (f"Risco elevado ou margem insuficiente. Score combinado de {combined_score:.1f} "
                  f"e probabilidade de prejuizo calculada em {loss_probability:.1f}%.")
                  
    return {
        "combined_score": round(combined_score, 2),
        "decision": decision,
        "justification": reason
    }
