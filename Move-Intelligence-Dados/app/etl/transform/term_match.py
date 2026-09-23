"""Relevância do título ao termo buscado (descoberta com --exact-term).

Mesma normalização e mesmas palavras genéricas do filtro de termos do backend
(Move-Intelligence-Back/src/modules/radar-discovery/discovery-candidates.ts).
"""

from __future__ import annotations

import math
import re
import unicodedata

GENERIC_WORDS = {
    "de", "da", "do", "das", "dos", "para", "com", "sem", "em", "the", "for", "with", "and", "of", "me",
    "buy", "price", "preco", "cheap", "barato", "used", "usado", "amazon", "machine", "maquina", "aparelho",
    "equipment", "equipamento", "set", "kit", "fitness", "gym", "academia", "home", "casa",
}


def normalize_term(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return " ".join(text.split())


def _counting(value: str) -> list[str]:
    return [word for word in normalize_term(value).split() if len(word) >= 3 and word not in GENERIC_WORDS]


def title_matches_term(title: str, term: str) -> bool:
    """True se o título tem pelo menos metade (arredondada para cima) das palavras do termo."""
    words = list(dict.fromkeys(_counting(term)))
    if not words or not normalize_term(title):
        return True
    title_words: set[str] = set()
    for word in _counting(title):
        title_words.add(word)
        if word.endswith("s"):
            title_words.add(word[:-1])
    hits = sum(1 for word in words if word in title_words or (word.endswith("s") and word[:-1] in title_words))
    return hits >= math.ceil(len(words) / 2)
