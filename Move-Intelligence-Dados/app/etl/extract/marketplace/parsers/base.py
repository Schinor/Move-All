"""Base dos parsers de acompanhamento: contrato e extração via JSON-LD.

O JSON-LD (schema.org ``Product``) é um padrão, não um formato chutado por
fonte: Amazon, Mercado Livre e Shopee o emitem. Regras conservadoras:
- preço só de ``offers.price`` com oferta ÚNICA (sem faixa, sem "12x");
- múltiplas ofertas ou preço ausente → tenta os blocos do markdown
  VALIDADOS NAS FIXTURES (A2); sem padrão conhecido → ``scrape_status='partial'``;
- vendidos: texto bruto guardado + limite inferior ("+1.000 vendidos" → 1000,
  "5 mil vendidos" → 5000).

Cada padrão fonte-específico cita a fixture que o originou. Sem fixture
real para a fonte, o parser é só JSON-LD + título genérico.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class ParsedListing:
    price: Optional[float]
    currency: Optional[str]
    rating: Optional[float]
    reviews_count: Optional[int]
    sold_count_raw: Optional[str]
    sold_count_lower: Optional[int]
    best_seller_rank: Optional[int]
    in_stock: Optional[bool]
    scrape_status: str  # ok | partial
    parser_version: str
    # Título real do anúncio (primeiro cabeçalho/linha de título; usado no
    # matching A3.2 em vez da URL).
    title: Optional[str] = None
    # Vendedor/fornecedor exibido na página (padrões validados por fixture).
    seller: Optional[str] = None
    # Distribuição de estrelas em PERCENTUAL {"1":..,"5":..} (A5); None sem dado.
    rating_distribution: Optional[dict[str, float]] = None
    # Campos B2B (Alibaba/1688/AliExpress, decisão 8): nome do fornecedor,
    # anos na plataforma, selo verificado, MOQ e faixas por quantidade.
    supplier_name: Optional[str] = None
    supplier_years: Optional[int] = None
    supplier_verified: Optional[bool] = None
    moq: Optional[int] = None
    price_tiers: Optional[list[dict[str, Any]]] = None


_SOLD_AFTER_RE = re.compile(
    r"\+?\s*([\d][\d.\s]*)\s*(mil|milhares|k)?\s*(vendidos?|sold)\b",
    flags=re.IGNORECASE,
)
_SOLD_BEFORE_RE = re.compile(
    r"(vendidos?\s*:?\s*\+?\s*)([\d][\d.\s]*)\s*(mil|milhares|k)?\b",
    flags=re.IGNORECASE,
)

_SOLD_KEYWORDS = ("vendid", "sold")


def parse_sold_count(text: str) -> tuple[Optional[str], Optional[int]]:
    """Extrai (texto bruto, limite inferior) de "vendidos" em PT/EN.

    "+1.000 vendidos" → ("+1.000 vendidos", 1000); "5 mil vendidos" → 5000.
    Sem menção a vendidos, devolve (None, None).
    """
    content = str(text or "")
    lowered = content.lower()
    if not any(keyword in lowered for keyword in _SOLD_KEYWORDS):
        return None, None
    # A palavra-chave é obrigatória no match (senão "24kg" casaria "24k").
    match = _SOLD_AFTER_RE.search(content)
    if match:
        raw, number_raw, multiplier = match.group(0).strip(), match.group(1), (match.group(2) or "").lower()
    else:
        before = _SOLD_BEFORE_RE.search(content)
        if not before:
            return None, None
        raw, number_raw, multiplier = (
            before.group(0).strip(),
            before.group(2),
            (before.group(3) or "").lower(),
        )
    digits = re.sub(r"[.\s]", "", number_raw).replace(",", ".")
    try:
        number = float(digits)
    except ValueError:
        return raw, None
    if multiplier in {"mil", "milhares", "k"}:
        number *= 1000
    # Limite inferior: "+1.000" significa pelo menos 1000.
    return raw, int(number)


def extract_json_ld_products(markdown: str) -> list[Mapping[str, Any]]:
    """Coleta blocos JSON-LD com @type Product do markdown."""
    content = str(markdown or "")
    blocks: list[str] = []
    # Blocos cercados ```json ... ``` (formato do scrape_as_markdown).
    blocks.extend(re.findall(r"```(?:json|json-ld)?\s*(\{.*?\})\s*```", content, flags=re.DOTALL))
    # Tags <script type="application/ld+json"> preservadas no markdown.
    blocks.extend(
        re.findall(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            content,
            flags=re.DOTALL | re.IGNORECASE,
        )
    )
    products: list[Mapping[str, Any]] = []
    for block in blocks:
        try:
            payload = json.loads(block)
        except (ValueError, TypeError):
            continue
        candidates = payload if isinstance(payload, list) else [payload]
        for candidate in candidates:
            if not isinstance(candidate, Mapping):
                continue
            graph = candidate.get("@graph")
            if isinstance(graph, list):
                products.extend(item for item in graph if _is_product(item))
            elif _is_product(candidate):
                products.append(candidate)
    return products


def _is_product(node: Any) -> bool:
    if not isinstance(node, Mapping):
        return False
    node_type = node.get("@type")
    types = node_type if isinstance(node_type, list) else [node_type]
    return any(str(item).casefold() == "product" for item in types)


def product_price(product: Mapping[str, Any]) -> tuple[Optional[float], Optional[str], bool]:
    """Preço inequívoco da oferta única. Retorna (preço, moeda, ambíguo)."""
    offers = product.get("offers")
    offer_list = offers if isinstance(offers, list) else ([offers] if isinstance(offers, Mapping) else [])
    priced = [offer for offer in offer_list if _offer_price(offer)[0] is not None]
    if len(priced) != 1:
        # Zero ofertas com preço ou faixa de preços (ex.: min/max, parcelas):
        # ambíguo — nunca escolher "o do bloco principal" no escuro.
        return None, None, True
    return _offer_price(priced[0])[0], _offer_price(priced[0])[1], False


def _offer_price(offer: Mapping[str, Any]) -> tuple[Optional[float], Optional[str]]:
    raw_price = offer.get("price", offer.get("lowPrice"))
    if raw_price is None:
        return None, None
    try:
        price = float(str(raw_price).replace(",", "."))
    except (ValueError, TypeError):
        return None, None
    if price <= 0:
        return None, None
    currency = offer.get("priceCurrency")
    return price, str(currency).upper() if currency else None


def product_rating(product: Mapping[str, Any]) -> tuple[Optional[float], Optional[int]]:
    aggregate = product.get("aggregateRating")
    if not isinstance(aggregate, Mapping):
        return None, None
    try:
        rating = float(str(aggregate.get("ratingValue", "")).replace(",", "."))
    except (ValueError, TypeError):
        rating = None
    try:
        count = int(float(str(aggregate.get("reviewCount", aggregate.get("ratingCount", "")))))
    except (ValueError, TypeError):
        count = None
    return rating, count


def content_hash(markdown: str) -> str:
    return hashlib.sha256(str(markdown or "").encode("utf-8")).hexdigest()


def fix_mojibake(text: str) -> str:
    """Desfaz dupla codificação UTF-8→latin-1 do scrape ("AjustÃ¡vel"→"Ajustável").

    Observado nas fixtures reais A1 (Amazon BR/US, ML, Shopee, Alibaba). Remove
    antes os invisíveis que quebram a conversão (zero-width da Shopee); se a
    conversão completa falhar, remove ao menos a cola "Â" dos preços
    ("R$Â\xa01.161,80"→"R$ 1.161,80"). Nunca levanta exceção.
    """
    content = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", str(text or ""))
    if "Ã" not in content and "Â" not in content:
        return content
    try:
        return content.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return re.sub(r"Â\s?", " ", content)


def extract_title(markdown: str) -> Optional[str]:
    """Título real: primeira linha substancial, sem prefixo/sufixo da loja."""
    for line in fix_mojibake(markdown).splitlines():
        cleaned = re.sub(r"^#+\s*", "", line).strip()
        if len(cleaned) < 15:
            continue
        if re.match(r"^(ir para|atalhos|menu|pular|skip)\b", cleaned, re.IGNORECASE):
            continue
        # Linha de preço ("Preço R$ 100,00") não é título.
        if re.search(r"(R\$|US\$|€|¥|CNY|\$)\s?\d", cleaned):
            continue
        # Prefixo da loja ("Amazon.com : ") é chrome, não título. Só prefixos
        # conhecidos — nunca comer "Oferta: ..." do próprio título.
        cleaned = re.sub(
            r"^(Amazon\.com(\.br)?|Shopee[^|]*|Mercado\s?Livre|Alibaba(\.com)?)\s*:\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        title = re.split(r"\s+\|\s+", cleaned)[0].strip()
        if len(title) >= 15:
            return title
    return None


# Símbolos de moeda aceitos nos blocos de preço (a moeda final vem do
# símbolo ou do default da fonte).
_CURRENCY_SYMBOLS = ("R$", "US$", "U$", "€", "EUR", "¥", "CNY", "$")

_PRICE_RE = re.compile(
    r"(?P<symbol>R\$|US\$|U\$|€|EUR|¥|CNY|\$)\s?(?P<value>\d[\d\.\s]*[,\.]\d{2}|\d[\d\.]*)",
)

# Parcela ("Em 12x de R$ 47,64", "12x R$57,44", "10x sem juros"): nunca é preço.
_INSTALLMENT_RE = re.compile(r"(\d+\s*x\s*(de|por)?|parcela)", re.IGNORECASE)
# Preço riscado/de lista ("Preço sem oferta", "De: R$", "era R$", "was $").
# ATENÇÃO: "de" sozinho NÃO entra aqui — em português ele acompanha o preço
# vigente ("a partir de R$") e excluir por ele mataria o principal
# (fixture shopee_br/product-01: R$1.161,80 sumiria e sobraria R$40).
_LIST_PRICE_RE = re.compile(
    r"(sem oferta|\bde\s*:\s*R?\$|\bera\b|\bantes\b|tachado|list price|\bwas\b|original\s*price)",
    re.IGNORECASE,
)


def parse_amount(raw: str) -> Optional[float]:
    """Número BR/US ("1.161,80"→1161.8; "1,161.80"→1161.8; "59"→59)."""
    text = re.sub(r"\s", "", str(raw or ""))
    if not text:
        return None
    if "," in text and "." in text:
        # O separador MAIS À DIREITA é o decimal (convenção BR e US).
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        fractional = text.rsplit(",", 1)[-1]
        text = text.replace(",", ".") if len(fractional) <= 2 else text.replace(",", "")
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def price_candidates(text: str) -> list[tuple[float, str, int, int]]:
    """Candidatos (valor, símbolo, início, fim) na ordem em que aparecem."""
    found: list[tuple[float, str, int, int]] = []
    for match in _PRICE_RE.finditer(text):
        value = parse_amount(match.group("value"))
        if value is not None:
            found.append((value, match.group("symbol"), match.start(), match.end()))
    return found


def _context(text: str, start: int, end: int, window: int = 40) -> tuple[str, str]:
    return text[max(0, start - window):start], text[end:end + window]


def is_installment(text: str, start: int, end: int) -> bool:
    before, after = _context(text, start, end, 25)
    if _INSTALLMENT_RE.search(before[-20:]):
        return True
    return bool(re.search(r"(sem juros|com juros|/mês|/mes\b)", after[:20], re.IGNORECASE))


def is_list_price(text: str, start: int, _end: int) -> bool:
    before, _after = _context(text, start, start, 45)
    return bool(_LIST_PRICE_RE.search(before))


# Frete nunca é preço (A2): "Frete R$65,39", "R$40,00 de desconto no frete".
# Fixture shopee_br/product-01 — sem isso, o frete (repetido no bloco de
# entrega) vencia o principal R$1.161,80.
_FREIGHT_BEFORE_RE = re.compile(r"(frete|freight|shipping|envio|entrega|delivery|shipment)\b", re.IGNORECASE)
_FREIGHT_AFTER_RE = re.compile(r"\s*(de desconto|discount|no frete)", re.IGNORECASE)


def is_freight(text: str, start: int, end: int) -> bool:
    before, after = _context(text, start, end, 30)
    if _FREIGHT_BEFORE_RE.search(before[-25:]):
        return True
    return bool(_FREIGHT_AFTER_RE.match(after[:25]))


def main_price(text: str) -> Optional[tuple[float, str]]:
    """Preço principal: exclui parcela/frete/lista; o mais frequente vence.

    Fixture amazon_br/product-01: R$639 (lista, "Preço sem oferta") aparece
    MAIS que o principal R$559,55 — frequência sozinha erraria. Com as
    exclusões, o principal vence (42 ocorrências).
    """
    candidates = [
        (value, symbol, start, end)
        for value, symbol, start, end in price_candidates(text)
        if not is_installment(text, start, end)
        and not is_list_price(text, start, end)
        and not is_freight(text, start, end)
    ]
    if not candidates:
        return None
    counts: dict[tuple[float, str], int] = {}
    order: list[tuple[float, str]] = []
    for value, symbol, _s, _e in candidates:
        key = (round(value, 2), symbol)
        if key not in counts:
            counts[key] = 0
            order.append(key)
        counts[key] += 1
    best = max(order, key=lambda key: (counts[key], -order.index(key)))
    return best[0], best[1]


def symbol_to_currency(symbol: str, default: Optional[str]) -> Optional[str]:
    upper = symbol.upper().replace(" ", "")
    if upper in {"R$"}:
        return "BRL"
    if upper in {"US$", "U$"}:
        return "USD"
    if upper in {"€", "EUR"}:
        return "EUR"
    if upper in {"¥", "CNY"}:
        return "CNY"
    if upper == "$":
        return default
    return default


def parse_stars_distribution(text: str) -> Optional[dict[str, float]]:
    """Distribuição "5 estrelas...1 estrela 100%0%0%0%0%" → percentual por estrela.

    Fixtures amazon_br/product-01 ("...1 estrela5 estrelas 100%0%0%0%0%100%")
    e amazon/product-01 ("5 star...1 star5 star 70%17%6%2%5%70%", EN): os
    rótulos vêm colados, às vezes com o "5 estrelas" repetido antes dos
    percentuais — os 5 PRIMEIROS valem. Sem o bloco completo, None.
    """
    match = re.search(
        r"5\s*(?:estrelas?|stars?)\s*4\s*(?:estrelas?|stars?)\s*3\s*(?:estrelas?|stars?)"
        r"\s*2\s*(?:estrelas?|stars?)\s*1\s*(?:estrelas?|stars?)"
        r"(?:\s*5\s*(?:estrelas?|stars?))?\s*((?:[\d.,]+%\s*){5,6})",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    percents = [p.replace(",", ".").rstrip("%") for p in re.findall(r"[\d.,]+%", match.group(1))]
    if len(percents) < 5:
        return None
    try:
        values = [float(p) for p in percents[:5]]
    except ValueError:
        return None
    return {str(star): values[5 - star] for star in range(1, 6)}


def parse_bsr(text: str) -> Optional[int]:
    """BSR "#1.234 em Esporte" (Amazon). Sem número inequívoco → None."""
    match = re.search(r"#\s?([\d\.,]+)\s+em\s+[\w &]{3,60}", text)
    if not match:
        return None
    try:
        return int(re.sub(r"[^\d]", "", match.group(1)))
    except ValueError:
        return None


def parse_in_stock(text: str) -> Optional[bool]:
    if re.search(r"\b(em estoque|in stock|estoque dispon(í|i)vel|disponible)\b", text, re.IGNORECASE):
        return True
    if re.search(r"\b(esgotado|out of stock|indispon[ií]vel|sin stock|agotado)\b", text, re.IGNORECASE):
        return False
    return None


__all__ = [
    "ParsedListing",
    "content_hash",
    "extract_json_ld_products",
    "extract_title",
    "fix_mojibake",
    "is_installment",
    "is_freight",
    "is_list_price",
    "main_price",
    "parse_amount",
    "parse_bsr",
    "parse_in_stock",
    "parse_sold_count",
    "parse_stars_distribution",
    "price_candidates",
    "product_price",
    "product_rating",
    "symbol_to_currency",
]
