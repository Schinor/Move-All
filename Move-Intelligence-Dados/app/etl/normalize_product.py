import re
from typing import Dict, Any

def extract_attributes(title: str) -> Dict[str, Any]:
    """
    Normaliza e extrai atributos relevantes do título de produtos do ramo fitness
    (marca, peso/carga, níveis de intensidade, especificações técnicas).
    """
    attributes = {
        "brand": "Genérico",
        "model": "unknown",
        "specifications": {}
    }
    
    title_lower = title.lower()
    
    # 1. Marcas comuns do mercado fitness nacional e internacional
    fitness_brands = [
        "movement", "kikos", "speedo", "liveup", "technogym", "matrix",
        "life fitness", "precor", "rogue", "bowflex", "yangfit", "proform",
        "odin fit", "acte sports", "domyos", "decathlon", "athletic",
        "lion fitness", "konnen", "iron force", "rudel", "everlast",
        "oxer", "genis", "podiumfit", "dream fitness", "nordictrack",
        "titan fitness", "concept2", "torp", "gonew"
    ]
    for brand in fitness_brands:
        if brand in title_lower:
            attributes["brand"] = brand.title()
            break
            
    # 2. Extrair peso / carga (ex: 24kg, 16 kg, 50 lbs)
    weight_match = re.search(r'(\d+(?:[\.,]\d+)?)\s*(kg|quilos|kilos|lbs|libras)', title_lower)
    if weight_match:
        attributes["specifications"]["weight"] = f"{weight_match.group(1).replace(',', '.')} {weight_match.group(2).upper()}"
        
    # 3. Extrair níveis / intensidades / peças (ex: kit 5 peças, 3 níveis)
    levels_match = re.search(r'(\d+)\s*(niveis|níveis|intensidades|pecas|peças|pcs)', title_lower)
    if levels_match:
        attributes["specifications"]["intensity_levels"] = f"{levels_match.group(1)} {levels_match.group(2)}"

    # 4. Extrair espessura (ex: 10mm, 15mm, 4mm para tapetes de yoga/colchonetes)
    thickness_match = re.search(r'(\d+(?:[\.,]\d+)?)\s*(mm|cm)', title_lower)
    if thickness_match:
        attributes["specifications"]["thickness"] = f"{thickness_match.group(1).replace(',', '.')} {thickness_match.group(2).upper()}"

    # 5. Extrair voltagem se houver (para esteiras, plataformas vibratórias, etc.)
    voltage_match = re.search(r'(110v|220v|bivolt|\d+\s*(?:v|volts))', title_lower)
    if voltage_match:
        attributes["specifications"]["voltage"] = voltage_match.group(0).upper()
        
    return attributes
