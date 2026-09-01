from typing import Dict

def calculate_financial_metrics(average_sale_price: float, estimated_cost: float) -> Dict[str, float]:
    """
    Calcula margem bruta, ROI estimado e gera um score financeiro (0 a 100).
    """
    if estimated_cost <= 0:
        return {
            "gross_margin": 0.0,
            "estimated_roi": 0.0,
            "financial_score": 0.0
        }
        
    profit = average_sale_price - estimated_cost
    gross_margin = (profit / average_sale_price) * 100 if average_sale_price > 0 else 0.0
    estimated_roi = (profit / estimated_cost) * 100
    
    # Financial Score: penaliza ROI baixo e margem baixa
    # ROI ideal >= 30%, Margem ideal >= 25%
    roi_score = min(100.0, (estimated_roi / 40.0) * 100) if estimated_roi > 0 else 0.0
    margin_score = min(100.0, (gross_margin / 30.0) * 100) if gross_margin > 0 else 0.0
    
    financial_score = (roi_score * 0.6) + (margin_score * 0.4)
    financial_score = max(0.0, min(100.0, financial_score))
    
    return {
        "gross_margin": round(gross_margin, 2),
        "estimated_roi": round(estimated_roi, 2),
        "financial_score": round(financial_score, 2)
    }
