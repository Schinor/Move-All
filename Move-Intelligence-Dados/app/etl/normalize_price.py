import re

def parse_price(price_str: str) -> float:
    """
    Normaliza strings de precos (ex: 'R$ 1.500,50', 'U$S 1,200.00', '150.00') para float.
    """
    if not price_str:
        return 0.0
        
    # Remove simbolos de moeda e espacos
    price_str = re.sub(r'[a-zA-Z\$]', '', price_str).strip()
    
    if not price_str:
        return 0.0

    # Verifica o formato de separadores decimais/milhar
    # Se contem pontos e virgula (ex: 1.500,50)
    if ',' in price_str and '.' in price_str:
        # Se a virgula vem depois do ultimo ponto, padrao brasileiro/europeu (1.500,50)
        if price_str.rfind(',') > price_str.rfind('.'):
            price_str = price_str.replace('.', '').replace(',', '.')
        else:
            # Padrao americano/ingles (1,500.50)
            price_str = price_str.replace(',', '')
    elif ',' in price_str:
        # Se contem apenas virgula, ex: "1500,50" ou "1,500" (se for milhar)
        # Assumimos que se tiver ate duas casas decimais apos a virgula, eh decimal
        parts = price_str.split(',')
        if len(parts[-1]) <= 2:
            price_str = price_str.replace(',', '.')
        else:
            # Se for mais que 2 digitos, ex: "1,500" (milhar americano)
            price_str = price_str.replace(',', '')
            
    try:
        return float(price_str)
    except ValueError:
        return 0.0
