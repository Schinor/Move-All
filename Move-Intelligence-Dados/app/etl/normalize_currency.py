from typing import Dict

def convert_to_brl(price: float, source_currency: str, exchange_rates: Dict[str, float]) -> float:
    """
    Converte valores monetarios de moedas estrangeiras para BRL usando as taxas de cambio fornecidas.
    Se a moeda de origem ja for BRL, retorna o valor original.
    """
    source_currency = source_currency.upper().strip()
    
    if source_currency == "BRL":
        return price
        
    # Obtem a taxa da moeda base (USD por padrao na API)
    # Se a taxa estiver indexada em relacao a USD:
    # BRL rate = R$ por USD (ex: 5.45)
    # Target rate = Moeda por USD (ex: EUR = 0.92)
    # Price em EUR -> Price em USD = Price / 0.92 -> Price em BRL = Price / 0.92 * 5.45
    
    usd_to_brl = exchange_rates.get("BRL", 5.45)
    
    # Se a taxa da moeda de origem em relacao a USD existir:
    if source_currency in exchange_rates:
        usd_to_source = exchange_rates[source_currency]
        # Converte para USD primeiro
        price_usd = price / usd_to_source
        # Converte para BRL
        price_brl = price_usd * usd_to_brl
        return round(price_brl, 2)
        
    # Se for uma moeda desconhecida, assume multiplicador USD direto se for USD
    if source_currency == "USD":
        return round(price * usd_to_brl, 2)
        
    # Fallback caso nao encontre taxa
    return round(price, 2)
