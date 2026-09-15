"""Captura A1 do plano (PAGO — usar com autorização do Raul).

1 página de produto por fonte via `scrape_as_markdown` (+ 1 busca para achar
a URL) + 1 página de avaliações Amazon BR + seção de opiniões do ML.
Cada chamada conta no total impresso ao final. Sem retry: falhou, registra e
segue (não gasta de novo). Nomes de avaliadores são redigidos nas fixtures.

Uso:
    venv/bin/python scripts/capture_a1_fixtures.py [--only amazon_br,aliexpress]
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
FIXTURES = REPO / "tests" / "fixtures" / "markdown"


def _load_dotenv() -> None:
    import os

    env_file = REPO / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip().strip('"').strip("'")


_load_dotenv()

from app.etl.extract.marketplace.common import BrightDataClient  # noqa: E402
from app.pipelines.run_live_intelligence import _extractor_registry  # noqa: E402

QUERIES = {
    # A1 usa "{query} site:dominio" no SERP (site: no início retornou vazio).
    "amazon_br": "haltere ajustável 24kg site:amazon.com.br",
    "amazon": "adjustable dumbbell 52.5 site:amazon.com",
    "mercado_livre": "haltere ajustável 24kg site:mercadolivre.com.br",
    "shopee_br": "halter ajustável 24kg site:shopee.com.br",
    "alibaba": "adjustable dumbbell site:alibaba.com",
    "1688": "dumbbell site:1688.com",
    "aliexpress": "adjustable dumbbell 24kg site:aliexpress.com",
    "tiktok_shop": "adjustable dumbbell site:shop.tiktok.com",
}

# Descoberta via unlocker (sem Google SERP): raspa a busca do próprio site
# (1 req) e extrai links diretos de produto — sem /goto no caminho.
SITE_SEARCH = {
    "amazon_br": "https://www.amazon.com.br/s?k=haltere+ajustavel+24kg",
    "amazon": "https://www.amazon.com/s?k=adjustable+dumbbell+52.5",
    "mercado_livre": "https://lista.mercadolivre.com.br/haltere-ajustavel-24kg",
    "shopee_br": "https://shopee.com.br/search?keyword=halter%20ajustavel",
    "alibaba": "https://www.alibaba.com/trade/search?searchText=adjustable+dumbbell",
    "1688": "https://s.1688.com/selloffer/offer_search.htm?keywords=dumbbell",
    "aliexpress": "https://www.aliexpress.com/wholesale?SearchText=adjustable+dumbbell",
    "tiktok_shop": "",
}

_MD_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
_BARE_URL_RE = re.compile(r"https?://[^\s)'\"<>\\]+")

# Anfitrião + caminho válidos por fonte (evita rastreadores /aax-... que
# citam /dp/ dentro do próprio URL de anúncio).
_HOST_PATH = {
    "amazon_br": ("amazon.com.br", r"/dp/[A-Z0-9]{10}"),
    "amazon": ("amazon.com", r"/dp/[A-Z0-9]{10}"),
    "mercado_livre": ("mercadolivre.com", r"/(p/|[^/]+/p/|MLB-)"),
    "shopee_br": ("shopee.com.br", r"-i\.\d+\.\d+"),
    "alibaba": ("alibaba.com", r"/product-detail/"),
    "1688": ("1688.com", r"/offer/\d+\.html"),
    "aliexpress": ("aliexpress.com", r"/item/\d+\.html"),
    "tiktok_shop": ("shop.tiktok.com", r"/pdp/"),
}


def extract_product_urls(markdown: str, profile, base_url: str) -> list[str]:
    """Links de produto (canônicos, sem query) na ordem em que aparecem."""
    from urllib.parse import urljoin, urlparse, urlunparse

    found: list[str] = []
    seen: set[str] = set()
    # O markdown do Bright Data escapa underscores (pd\_rd\_i); desfaz.
    text = (markdown or "").replace("\\_", "_").replace("\\-", "-")
    raw_urls = _MD_LINK_RE.findall(text) + _BARE_URL_RE.findall(text)
    # Links relativos (/dp/ASIN...) comuns na busca Amazon.
    raw_urls += re.findall(r"\]\((/[^)\s]+)\)", text)
    host, path_re = _HOST_PATH.get(profile.source, ("", ""))
    for raw in raw_urls:
        absolute = urljoin(base_url, raw.split("#")[0].strip())
        try:
            parts = urlparse(absolute)
        except ValueError:
            continue
        if host and host not in (parts.netloc or "").lower():
            continue
        if path_re and not re.search(path_re, parts.path or "", re.IGNORECASE):
            continue
        if not profile.accepted_url.search(absolute):
            continue
        canonical = urlunparse((parts.scheme, parts.netloc, parts.path, "", "", ""))
        if canonical not in seen:
            seen.add(canonical)
            found.append(canonical)
    return found

# Padrões de nome de avaliador redigidos (JSON-LD author + blocos de review).
_AUTHOR_RE = re.compile(r'"author"\s*:\s*\{.*?\}', re.DOTALL)

_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}


def resolve_link(link: str) -> str:
    """Desembrulha links do SERP sem gastar Bright Data (GET local grátis).

    - `/goto?url=<token>` → segue o 302 local e devolve o destino;
    - `/url?q=<destino>` → extrai o parâmetro q;
    - demais → devolve como está.
    """
    import requests

    text = (link or "").strip()
    if text.startswith("/goto?url=") or "/goto?url=" in text:
        token = text.split("url=", 1)[1].split("&")[0]
        try:
            response = requests.get(
                "https://www.google.com/goto?url=" + token,
                allow_redirects=False,
                timeout=20,
                headers=_UA,
            )
            if response.status_code in (301, 302, 303, 307, 308):
                return response.headers.get("Location", "").strip()
        except Exception:
            return ""
        return ""
    if text.startswith("/url?"):
        from urllib.parse import parse_qs, urlparse

        params = parse_qs(urlparse(text).query)
        return (params.get("q") or [""])[0].strip()
    return text


def sanitize(markdown: str) -> tuple[str, int]:
    """Redige nomes de quem avaliou; devolve (texto, nº de redações)."""
    cleaned, count = _AUTHOR_RE.subn('"author":{"@type":"Person","name":"[REMOVIDO]"}', markdown)
    return cleaned, count


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="fontes separadas por vírgula")
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="URL direta de produto (fonte=url, sem busca; pode repetir)",
    )
    parser.add_argument(
        "--serp",
        default="",
        help="fontes que usam Google SERP em vez da busca do site (vírgula)",
    )
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        help="query SERP customizada (fonte=texto, pode repetir)",
    )
    args = parser.parse_args()
    query_override = dict(
        item.split("=", 1) for item in args.query if "=" in item
    )
    serp_sources = {s.strip() for s in args.serp.split(",") if s.strip()}
    url_override = dict(
        item.split("=", 1) for item in args.url if "=" in item
    )
    only = [s.strip() for s in args.only.split(",") if s.strip()] or list(QUERIES)
    unknown = [s for s in only if s not in QUERIES]
    if unknown:
        raise SystemExit(f"Fontes desconhecidas: {unknown}")

    registry = _extractor_registry()
    client = BrightDataClient(timeout=120)
    total_requests = 0
    report: list[dict[str, object]] = []
    product_urls: dict[str, str] = {}

    for source in only:
        profile = registry[source](client=client).profile
        entry: dict[str, object] = {"source": source, "query": QUERIES[source]}
        try:
            # Descoberta via unlocker (sem Google SERP): raspa a busca do
            # próprio site e extrai links diretos (TikTok usa SERP, sem URL
            # de busca própria).
            candidates: list[str] = []
            if only and source in url_override:
                # URL direta (ASIN/ID já conhecido): sem busca, sem custo extra.
                candidates = [url_override[source]]
                entry["discovery"] = "url-direta"
            elif source in serp_sources:
                # Google SERP (1 busca) + resolução local grátis.
                query = query_override.get(source, QUERIES[source])
                search_response = client.search(query, profile.country)
                total_requests += 1
                organic = (
                    search_response.get("organic", [])
                    if isinstance(search_response, dict)
                    else []
                )
                entry["discovery"] = f"serp ({len(organic) if isinstance(organic, list) else -1} resultados)"
                seen: set[str] = set()
                resolved_sample: list[str] = []
                for item in organic if isinstance(organic, list) else []:
                    if not isinstance(item, dict):
                        continue
                    raw = str(item.get("link") or item.get("url") or "")
                    link = resolve_link(raw)
                    if len(resolved_sample) < 5:
                        resolved_sample.append(link or f"(vazio de {raw[:40]})")
                    if not link or not profile.accepted_url.search(link):
                        continue
                    if link not in seen:
                        seen.add(link)
                        candidates.append(link)
                        if len(candidates) >= 2:
                            break
                entry["resolved_sample"] = resolved_sample
            else:
                search_url = SITE_SEARCH[source]
                search_md = client.scrape(search_url, profile.country)
                total_requests += 1
                entry["discovery"] = f"site-search ({len(search_md or '')} chars)"
                candidates = extract_product_urls(search_md, profile, search_url)
            if not candidates:
                entry["status"] = "sem_candidatos"
                report.append(entry)
                print(f"[{source}] descoberta ok, nenhum produto ({total_requests} req)", flush=True)
                continue
            # Tenta até 2 candidatos (o scrape às vezes volta vazio).
            markdown = ""
            url = candidates[0]
            scraped_urls: list[str] = []
            for candidate_url in candidates[:2]:
                try:
                    markdown = client.scrape(candidate_url, profile.country)
                    total_requests += 1
                    scraped_urls.append(candidate_url)
                except Exception as error:
                    entry.setdefault("scrape_errors", []).append(
                        f"{candidate_url}: {str(error)[:120]}"
                    )
                    continue
                if len(markdown or "") >= 500:
                    url = candidate_url
                    break
            if len(markdown or "") < 500:
                entry["status"] = "conteudo_vazio"
                entry["scraped_urls"] = scraped_urls
                report.append(entry)
                print(f"[{source}] scrape vazio ({total_requests} req)", flush=True)
                continue
            cleaned, redactions = sanitize(markdown)
            out_dir = FIXTURES / source
            out_dir.mkdir(parents=True, exist_ok=True)
            # Próximo slot livre (product-01, product-02, ...): não sobrescreve.
            slot = 1
            while (out_dir / f"product-{slot:02d}.md").exists():
                slot += 1
            (out_dir / f"product-{slot:02d}.md").write_text(cleaned, encoding="utf-8")
            (out_dir / f"product-{slot:02d}.meta.json").write_text(
                json.dumps(
                    {
                        "source": source,
                        "url": url,
                        "discovery": entry.get("discovery"),
                        "discovery_url": SITE_SEARCH.get(source) or QUERIES[source],
                        "captured_at": datetime.now(timezone.utc).isoformat(),
                        "chars": len(cleaned),
                        "redactions": redactions,
                        "candidates": len(candidates),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            product_urls[source] = url
            entry.update(
                status="ok",
                url=url,
                chars=len(cleaned),
                redactions=redactions,
                has_json_ld=("application/ld+json" in cleaned or '"@type"' in cleaned),
            )
            print(f"[{source}] OK {len(cleaned)} chars, {redactions} redações ({total_requests} req)", flush=True)
        except Exception as error:
            entry["status"] = "erro"
            entry["error"] = str(error)[:300]
            print(f"[{source}] ERRO: {str(error)[:200]} ({total_requests} req)", flush=True)
        report.append(entry)

    # Avaliações Amazon BR: /product-reviews/<ASIN> do produto capturado.
    amazon_url = product_urls.get("amazon_br", "")
    asin_match = re.search(r"/dp/([A-Z0-9]{10})", amazon_url or "")
    if asin_match:
        try:
            reviews_url = f"https://www.amazon.com.br/product-reviews/{asin_match.group(1)}"
            markdown = client.scrape(reviews_url, "br")
            total_requests += 1
            if len(markdown or "") < 500:
                report.append({"source": "amazon_br/reviews", "status": "conteudo_vazio"})
                print(f"[amazon_br/reviews] vazio ({total_requests} req)", flush=True)
            else:
                cleaned, redactions = sanitize(markdown)
                out_dir = FIXTURES / "amazon_br"
                (out_dir / "reviews-01.md").write_text(cleaned, encoding="utf-8")
                (out_dir / "reviews-01.meta.json").write_text(
                    json.dumps(
                        {
                            "source": "amazon_br",
                            "url": reviews_url,
                            "captured_at": datetime.now(timezone.utc).isoformat(),
                            "chars": len(cleaned),
                            "redactions": redactions,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                report.append({"source": "amazon_br/reviews", "status": "ok", "chars": len(cleaned)})
                print(f"[amazon_br/reviews] OK ({total_requests} req)", flush=True)
        except Exception as error:
            report.append({"source": "amazon_br/reviews", "status": "erro", "error": str(error)[:300]})
            print(f"[amazon_br/reviews] ERRO ({total_requests} req)", flush=True)

    print("TOTAL_REQUISICOES=" + str(total_requests))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
