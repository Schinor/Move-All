import re
from typing import List, Dict, Tuple, Optional

def _tokenize(text: str) -> set:
    """
    Tokeniza strings e retorna um conjunto de palavras unicas.
    """
    if not text:
        return set()
    text = text.lower()
    # Remove pontuacao e caracteres irrelevantes
    tokens = re.findall(r'\b\w+\b', text)
    # Remove stopwords basicas de marketplace
    stopwords = {"de", "com", "para", "em", "o", "a", "os", "as", "um", "uma", "preto", "branco", "novo"}
    return {t for t in tokens if t not in stopwords}

def calculate_jaccard_similarity(str1: str, str2: str) -> float:
    """
    Calcula a similaridade de Jaccard entre dois conjuntos de tokens de strings.
    """
    set1 = _tokenize(str1)
    set2 = _tokenize(str2)
    
    if not set1 or not set2:
        return 0.0
        
    intersection = set1.intersection(set2)
    union = set1.union(set2)
    
    return len(intersection) / len(union)

def resolve_product(listing_title: str, existing_products: List[Dict], threshold: float = 0.5) -> Optional[str]:
    """
    Verifica se um anuncio corresponde a algum produto do catalogo existente.
    Retorna o ID do produto mais proximo se ultrapassar o limiar de similaridade.
    """
    best_match_id = None
    highest_similarity = 0.0
    
    for product in existing_products:
        sim = calculate_jaccard_similarity(listing_title, product["title"])
        if sim > highest_similarity:
            highest_similarity = sim
            best_match_id = product["id"]
            
    if highest_similarity >= threshold:
        return best_match_id
        
    return None
