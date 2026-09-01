from typing import List, Dict

def deduplicate_listings(listings: List[Dict]) -> List[Dict]:
    """
    Remove duplicados de uma lista de dicionarios de anuncios.
    Usa uma chave combinada (source_name, source_id) para garantir unicidade.
    Em caso de colisoes, mantem a coleta mais recente ou com informacoes mais completas.
    """
    unique_listings = {}
    
    for item in listings:
        source_name = item.get("source_name")
        source_id = item.get("source_id")
        
        if not source_name or not source_id:
            continue
            
        key = (source_name, source_id)
        
        # Se nao existe na tabela, adiciona
        if key not in unique_listings:
            unique_listings[key] = item
        else:
            # Se ja existe, compara precos ou ratings para manter o mais completo
            existing = unique_listings[key]
            # Mantem o que tiver maior numero de avaliacoes ou preco maior que zero
            if item.get("reviews_count", 0) > existing.get("reviews_count", 0):
                unique_listings[key] = item
                
    return list(unique_listings.values())
