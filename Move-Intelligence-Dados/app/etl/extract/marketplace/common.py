"""Primitivas compartilhadas pelos extractors Bright Data de marketplace.

O módulo conhece a API e o formato de evidência, mas não conhece SQLAlchemy,
modelos ou qualquer banco. Cada extractor pode receber um cliente fake nos
testes e, portanto, o parsing também funciona offline.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional, Pattern
from urllib.parse import urlsplit, urlunsplit

import requests


API_URL = "https://api.brightdata.com/request"
MCP_PROTOCOL_VERSION = "2025-03-26"


class BrightDataRequestError(RuntimeError):
    def __init__(self, status: int, body: str):
        self.status = status
        self.body = body
        super().__init__(f"Bright Data retornou HTTP {status}: {body[:500]}")


class BrightDataMcpError(RuntimeError):
    """Erro sanitizado do MCP; nunca inclui a URL tokenizada da conexão."""


@dataclass(frozen=True)
class MarketplaceProfile:
    source: str
    country: str
    query_template: str
    accepted_url: Pattern[str]
    default_currency: Optional[str] = None

    def build_query(self, query: str) -> str:
        return self.query_template.format(query=query.strip())


class BrightDataClient:
    """Cliente Bright Data com MCP como provedor padrão.

    Em desenvolvimento local, a URL tokenizada é descoberta pela configuração
    ``bright_data`` do Codex. Em servidores, ``BRIGHTDATA_MCP_URL`` injeta o
    mesmo endpoint como segredo. O modo REST legado continua disponível por
    ``BRIGHTDATA_PROVIDER=rest``, mas não é necessário para o fluxo MCP.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        serp_zone: Optional[str] = None,
        unlocker_zone: Optional[str] = None,
        timeout: int = 60,
        api_url: str = API_URL,
        provider: Optional[str] = None,
        mcp_url: Optional[str] = None,
        mcp_name: Optional[str] = None,
    ):
        self.api_key = api_key or os.getenv("BRIGHTDATA_API_KEY")
        self.serp_zone = serp_zone or os.getenv("BRIGHTDATA_SERP_ZONE")
        self.unlocker_zone = unlocker_zone or os.getenv("BRIGHTDATA_UNLOCKER_ZONE")
        self.timeout = timeout
        self.api_url = api_url
        self.provider = (provider or os.getenv("BRIGHTDATA_PROVIDER") or "mcp").strip().casefold()
        if self.provider not in {"mcp", "rest"}:
            raise ValueError("BRIGHTDATA_PROVIDER deve ser 'mcp' ou 'rest'")
        self.mcp_url = mcp_url or os.getenv("BRIGHTDATA_MCP_URL")
        self.mcp_name = mcp_name or os.getenv("BRIGHTDATA_MCP_NAME") or "bright_data"
        self._mcp_session_id: Optional[str] = None
        self._mcp_lock = threading.Lock()
        self._mcp_request_id = 1
        self._mcp_request_semaphore = threading.BoundedSemaphore(
            max(1, int(os.getenv("BRIGHTDATA_MCP_MAX_CONCURRENCY", "8")))
        )

    @property
    def collection_method(self) -> str:
        return (
            "Bright Data MCP (search_engine + scrape_as_markdown)"
            if self.provider == "mcp"
            else "Bright Data SERP API + Web Unlocker"
        )

    def _rest_request(self, payload: Mapping[str, Any]) -> Any:
        if not self.api_key:
            raise ValueError("BRIGHTDATA_API_KEY não configurada")

        response = requests.post(
            self.api_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=dict(payload),
            timeout=self.timeout,
        )
        body = response.text
        if not response.ok:
            # 429/bloqueios não são reexecutados automaticamente. O chamador
            # recebe o erro e conserva os registros parciais já coletados.
            raise BrightDataRequestError(response.status_code, body)
        try:
            return response.json()
        except ValueError:
            return body

    def _resolve_mcp_url(self) -> str:
        if self.mcp_url:
            return self.mcp_url
        discovery = os.getenv("BRIGHTDATA_MCP_DISCOVER_CODEX", "true").strip().casefold()
        if discovery in {"0", "false", "no", "off"}:
            raise BrightDataMcpError(
                "BRIGHTDATA_MCP_URL não configurada e descoberta pelo Codex desativada"
            )
        try:
            result = subprocess.run(
                ["codex", "mcp", "get", self.mcp_name, "--json"],
                capture_output=True,
                check=False,
                text=True,
                timeout=10,
            )
            config = json.loads(result.stdout or "{}")
            transport = config.get("transport") if isinstance(config, Mapping) else None
            url = transport.get("url") if isinstance(transport, Mapping) else None
        except (FileNotFoundError, json.JSONDecodeError, subprocess.SubprocessError):
            url = None
        if not isinstance(url, str) or not url.strip():
            raise BrightDataMcpError(
                f"MCP Bright Data '{self.mcp_name}' não encontrado no Codex; "
                "configure-o localmente ou defina BRIGHTDATA_MCP_URL no servidor"
            )
        self.mcp_url = url.strip()
        return self.mcp_url

    @staticmethod
    def _decode_mcp_response(
        response: requests.Response, max_wait_seconds: Optional[int] = None
    ) -> Any:
        content_type = response.headers.get("content-type", "").casefold()
        # MCP streamable HTTP pode manter o SSE aberto após entregar a resposta.
        # Consumimos somente até o primeiro resultado/erro JSON-RPC para não
        # aguardar indefinidamente o fechamento da conexão.
        if "text/event-stream" in content_type and hasattr(response, "iter_lines"):
            # SSE sem charset: o requests assume ISO-8859-1 e quebra os acentos
            # (ex.: "acupressÃ£o" no radar, Subprojeto D). A Bright Data envia UTF-8.
            try:
                response.encoding = "utf-8"
            except AttributeError:
                pass
            messages: list[Any] = []
            deadline = (
                time.monotonic() + max_wait_seconds
                if max_wait_seconds is not None
                else None
            )
            try:
                for raw_line in response.iter_lines(decode_unicode=True):
                    if deadline is not None and time.monotonic() >= deadline:
                        raise BrightDataMcpError(
                            "MCP Bright Data excedeu o tempo total da solicitação"
                        )
                    line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                    if not isinstance(line, str) or not line.startswith("data:"):
                        continue
                    try:
                        message = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    messages.append(message)
                    if isinstance(message, Mapping) and (
                        "result" in message or "error" in message
                    ):
                        break
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()
            return messages[-1] if messages else None

        raw_content = getattr(response, "content", None)
        if isinstance(raw_content, bytes):
            try:
                response_text = raw_content.decode("utf-8")
            except UnicodeDecodeError:
                response_text = response.text
        else:
            response_text = response.text
        if not response_text.strip():
            return None
        if "text/event-stream" not in content_type and not response_text.lstrip().startswith("event:"):
            try:
                return json.loads(response_text)
            except json.JSONDecodeError:
                return None
        messages: list[Any] = []
        for line in response_text.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                messages.append(json.loads(line[5:].strip()))
            except json.JSONDecodeError:
                continue
        return messages[-1] if messages else None

    @staticmethod
    def _contains_session_marker(value: Any) -> bool:
        if value is None:
            return False
        text = str(value).casefold()
        return "sessão" in text or "session" in text

    def _discard_mcp_session(self) -> None:
        self._mcp_session_id = None

    def _mcp_post(self, payload: Mapping[str, Any], *, initialize_session: bool = True) -> Any:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        }
        if initialize_session:
            self._ensure_mcp_session()
        if self._mcp_session_id:
            headers["Mcp-Session-Id"] = self._mcp_session_id
        with self._mcp_request_semaphore:
            try:
                response = requests.post(
                    self._resolve_mcp_url(),
                    headers=headers,
                    json=dict(payload),
                    timeout=self.timeout,
                    stream=True,
                )
            except requests.RequestException:
                self._discard_mcp_session()
                raise BrightDataMcpError("Falha de conexão com o MCP Bright Data") from None
            status_code = getattr(response, "status_code", None)
            if isinstance(status_code, int) and 400 <= status_code < 600:
                self._discard_mcp_session()
                raise BrightDataMcpError(f"MCP Bright Data retornou HTTP {response.status_code}")
            try:
                decoded = self._decode_mcp_response(response, self.timeout)
            except BrightDataMcpError:
                self._discard_mcp_session()
                raise
        if isinstance(decoded, Mapping) and decoded.get("error"):
            error = decoded["error"]
            message = error.get("message") if isinstance(error, Mapping) else str(error)
            if self._contains_session_marker(decoded) or self._contains_session_marker(message):
                self._discard_mcp_session()
            raise BrightDataMcpError(f"MCP Bright Data rejeitou a solicitação: {message}")
        if decoded is None and self._contains_session_marker(getattr(response, "text", None)):
            self._discard_mcp_session()
            raise BrightDataMcpError("MCP Bright Data retornou uma resposta de sessão inválida")
        return decoded

    def _ensure_mcp_session(self) -> None:
        if self._mcp_session_id:
            return
        with self._mcp_lock:
            if self._mcp_session_id:
                return
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "move-intelligence", "version": "2.0.0"},
                },
            }
            headers = {
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            }
            try:
                response = requests.post(
                    self._resolve_mcp_url(),
                    headers=headers,
                    json=payload,
                    timeout=self.timeout,
                    stream=True,
                )
            except requests.RequestException:
                self._discard_mcp_session()
                raise BrightDataMcpError("Falha ao iniciar sessão com o MCP Bright Data") from None
            status_code = getattr(response, "status_code", None)
            if isinstance(status_code, int) and 400 <= status_code < 600:
                self._discard_mcp_session()
                raise BrightDataMcpError(
                    f"MCP Bright Data recusou a inicialização com HTTP {response.status_code}"
                )
            try:
                decoded = self._decode_mcp_response(response, self.timeout)
            except BrightDataMcpError:
                self._discard_mcp_session()
                raise
            if not isinstance(decoded, Mapping) or decoded.get("error"):
                self._discard_mcp_session()
                raise BrightDataMcpError("Resposta de inicialização inválida do MCP Bright Data")
            session_id = response.headers.get("mcp-session-id")
            if not session_id:
                self._discard_mcp_session()
                raise BrightDataMcpError("MCP Bright Data não retornou um identificador de sessão")
            self._mcp_session_id = session_id
            self._mcp_post(
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                    "params": {},
                },
                initialize_session=False,
            )

    @staticmethod
    def _unwrap_mcp_text(value: str) -> str:
        text = str(value or "")
        match = re.search(
            r"=====UNTRUSTED_[A-Za-z0-9]+_BEGIN=====\s*(.*?)\s*"
            r"=====UNTRUSTED_[A-Za-z0-9]+_END=====",
            text,
            flags=re.DOTALL,
        )
        return match.group(1).strip() if match else text.strip()

    def _call_mcp_tool(self, name: str, arguments: Mapping[str, Any]) -> str:
        with self._mcp_lock:
            self._mcp_request_id += 1
            request_id = self._mcp_request_id
        response = self._mcp_post(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {"name": name, "arguments": dict(arguments)},
            }
        )
        result = response.get("result") if isinstance(response, Mapping) else None
        if not isinstance(result, Mapping):
            raise BrightDataMcpError(f"Ferramenta MCP {name!r} retornou resposta inválida")
        content = result.get("content")
        texts = [
            str(item.get("text"))
            for item in content
            if isinstance(item, Mapping) and item.get("type") == "text" and item.get("text")
        ] if isinstance(content, list) else []
        text = "\n".join(texts)
        if result.get("isError"):
            if self._contains_session_marker(response) or self._contains_session_marker(text):
                self._discard_mcp_session()
            raise BrightDataMcpError(
                f"Ferramenta MCP {name!r} falhou: {self._unwrap_mcp_text(text)[:500]}"
            )
        return self._unwrap_mcp_text(text)

    def search(self, query: str, country: str) -> Any:
        if self.provider == "mcp":
            response = self._call_mcp_tool(
                "search_engine",
                {"query": query, "engine": "google", "geo_location": country.lower()},
            )
            return _parse_json(response)
        if not self.serp_zone:
            raise ValueError("BRIGHTDATA_SERP_ZONE não configurada")
        params = {
            "q": query,
            "hl": "zh" if country == "cn" else "en",
            "gl": country,
        }
        return self._rest_request(
            {
                "zone": self.serp_zone,
                "url": "https://www.google.com/search?" + requests.compat.urlencode(params),
                "format": "raw",
                "method": "GET",
                "data_format": "parsed_light",
            }
        )

    def google_trends(self, url: str) -> Any:
        """Consulta o Google Trends pelo MCP ou pelo modo REST legado."""

        if self.provider == "mcp":
            return self._call_mcp_tool("scrape_as_markdown", {"url": url})
        if not self.serp_zone:
            raise ValueError("BRIGHTDATA_SERP_ZONE não configurada")
        return self._rest_request(
            {
                "zone": self.serp_zone,
                "url": url,
                "format": "raw",
            }
        )

    def scrape(self, url: str, country: str) -> str:
        if self.provider == "mcp":
            return self._call_mcp_tool("scrape_as_markdown", {"url": url})
        if not self.unlocker_zone:
            raise ValueError("BRIGHTDATA_UNLOCKER_ZONE não configurada")
        response = self._rest_request(
            {
                "zone": self.unlocker_zone,
                "url": url,
                "format": "raw",
                "method": "GET",
                "country": country,
                "data_format": "markdown",
            }
        )
        if isinstance(response, str):
            return response
        if isinstance(response, Mapping):
            return str(response.get("content") or response.get("body") or json.dumps(response))
        return str(response)


def _parse_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def _organic(response: Any) -> list[Mapping[str, Any]]:
    parsed = _parse_json(response)
    if isinstance(parsed, Mapping):
        results = parsed.get("organic") or parsed.get("results")
        if isinstance(results, list):
            return [item for item in results if isinstance(item, Mapping)]

        for key in ("body", "content", "data", "result", "response"):
            nested = parsed.get(key)
            organic = _organic(nested)
            if organic:
                return organic
    return []


def canonical_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))
    except ValueError:
        return str(value or "").strip().lower().rstrip("/")


def parse_number(value: str) -> Optional[float]:
    text = re.sub(r"[^0-9,.-]", "", str(value or ""))
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(",", "") if text.rfind(".") > text.rfind(",") else text.replace(".", "").replace(",", ".")
    elif "," in text:
        fractional = text.rsplit(",", 1)[-1]
        text = text.replace(",", ".") if len(fractional) <= 2 else text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def extract_price(text: str, default_currency: Optional[str] = None) -> tuple[Optional[float], Optional[str]]:
    match = re.search(
        r"(?P<currency>R\$|BRL|US\$|USD|CNY|RMB|EUR|GBP|JPY|¥|￥|\$)\s*(?P<value>[0-9][0-9.,]*)",
        str(text or ""),
        flags=re.IGNORECASE,
    )
    if not match:
        return None, default_currency
    currency = match.group("currency").upper()
    currency = {
        "$": default_currency or "USD",
        "R$": "BRL",
        "¥": "CNY",
        "￥": "CNY",
        "RMB": "CNY",
    }.get(currency, currency)
    return parse_number(match.group("value")), currency


def extract_image_urls(markdown: str, source: str) -> list[str]:
    urls = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", str(markdown or ""))
    filters = {
        "amazon": r"(?:media-amazon|ssl-images-amazon)\.com/images/I/",
        "alibaba": r"alicdn|alibaba",
        "aliexpress": r"aliexpress|alicdn",
        "taobao": r"taobao|alicdn|tmall",
        "1688": r"1688|alicdn|tbcdn",
        "tiktok_shop": r"tiktokcdn|byteimg|ibytedtos",
        "amazon_br": r"(?:media-amazon|ssl-images-amazon)\.com/images/I/",
        "mercado_livre": r"mlstatic|mercadolivre",
        "shopee_br": r"shopee|shopeeusercontent|cf\.shopee",
    }
    pattern = filters.get(source)
    return list(
        dict.fromkeys(
            url
            for url in urls
            if url.startswith(("http://", "https://"))
            and (not pattern or re.search(pattern, url, re.IGNORECASE))
            and not re.search(r"logo|sprite|icon|error", url, re.IGNORECASE)
        )
    )


def extract_native_id(url: str, source: str) -> str:
    # Cada fonte pode ter mais de um formato de URL válido; os padrões são
    # tentados em ordem e o primeiro que casar vence.
    patterns: dict[str, list[str]] = {
        "amazon": [r"/dp/([A-Z0-9]{10})"],
        "amazon_br": [r"/dp/([A-Z0-9]{10})"],
        "alibaba": [r"[_-](\d{8,})\.html"],
        # AliExpress (A4): ID nativo = dígitos do item em /item/<id>.html.
        "aliexpress": [r"/item/(\d+)\.html"],
        "taobao": [r"/item/(\d+)"],
        "1688": [r"/offer/(\d+)\.html"],
        # Mercado Livre: o formato antigo capturava o slug do título junto do
        # ID (`(?:MLB-|/p/)([A-Z0-9-]+)`), então o ID mudava se o vendedor
        # editasse o título do anúncio. Agora extraímos só os dígitos do MLB,
        # cobrindo tanto o anúncio (".../MLB-3456789012-titulo-slug") quanto
        # a página de catálogo ("/p/MLB12345"); ambos são normalizados para
        # "MLB<dígitos>" logo abaixo.
        "mercado_livre": [r"MLB-?(\d+)"],
        # Shopee: o formato padrão é "...-i.{shop_id}.{item_id}". O padrão
        # antigo (`-i\.(\d+)\.\d+`) capturava o shop_id (1º grupo), fazendo
        # produtos distintos da mesma loja colidirem no mesmo record_id. O
        # item_id (2º grupo) é globalmente único no Shopee, então é ele que
        # deve virar o record_id. Também aceitamos o formato alternativo
        # "shopee.com.br/product/{shop_id}/{item_id}".
        "shopee_br": [r"-i\.\d+\.(\d+)", r"/product/\d+/(\d+)"],
    }
    for pattern in patterns.get(source, []):
        match = re.search(pattern, url, re.IGNORECASE)
        if match:
            native_id = match.group(1)
            if source == "mercado_livre":
                return f"MLB{native_id}"
            return native_id
    path = urlsplit(url).path.strip("/")
    basis = f"{source}:{path or url}".encode("utf-8")
    return hashlib.sha1(basis).hexdigest()[:32]


def unwrap_search_link(link: str) -> Optional[str]:
    """Desembrulha links do SERP para a URL direta do anúncio.

    O `search_engine` do MCP devolve `/goto?url=<token>` (redirecionador do
    Google) em vez da URL direta — sem desembrulhar, a descoberta não acha
    nenhum produto (A1, 14/09/2026). `/url?q=<destino>` sai por parsing local;
    `/goto?url=` exige 1 GET local no 302 (grátis, 10s; 400/429 → None).
    """
    from urllib.parse import parse_qs, urlparse

    text = (link or "").strip()
    if not text:
        return None
    if text.startswith("/url?") or "/url?" in text:
        try:
            params = parse_qs(urlparse(text).query)
            target = (params.get("q") or [""])[0].strip()
            return target or None
        except ValueError:
            return None
    if text.startswith("/goto?url=") or "/goto?url=" in text:
        token = text.split("url=", 1)[1].split("&")[0]
        if not token:
            return None
        try:
            response = requests.get(
                "https://www.google.com/goto?url=" + token,
                allow_redirects=False,
                timeout=10,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
            )
            if response.status_code in (301, 302, 303, 307, 308):
                return (response.headers.get("Location") or "").strip() or None
        except Exception:
            return None
        return None
    return text


class MarketplaceExtractor:
    def __init__(self, profile: MarketplaceProfile, client: Optional[BrightDataClient] = None):
        self.profile = profile
        self.client = client

    def discover_candidates(self, response: Any, query: str) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in _organic(response):
            raw = str(item.get("link") or item.get("url") or "").strip()
            if not raw:
                continue
            # Links do SERP vêm embrulhados (/goto?url=); desembrulha antes do
            # filtro, senão nenhum candidato passa (A1).
            url = unwrap_search_link(raw) or ""
            if not url or not self.profile.accepted_url.search(url):
                continue
            key = canonical_url(url)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(
                {
                    "title": item.get("title"),
                    "description": item.get("description") or item.get("snippet"),
                    "url": url,
                    "query": query,
                }
            )
        return candidates

    def parse_detail(self, candidate: Mapping[str, Any], markdown: str) -> dict[str, Any]:
        content = str(markdown or "")
        images = extract_image_urls(content, self.profile.source)
        price, currency = extract_price(
            content or str(candidate.get("description") or ""),
            self.profile.default_currency,
        )
        source_specific = {
            "search_query": candidate.get("query"),
            "source_page_url": candidate.get("url"),
            "image_urls": images,
            "detail_scrape_status": "ok" if content else "empty",
            "detail_content_chars": len(content),
            "raw_content_preview": content[:4000],
        }
        from app.etl.extract.marketplace.parsers.base import build_page_excerpt

        source_specific["page_excerpt"] = build_page_excerpt(content, title=str(candidate.get("title") or "") or None)
        # A3.4: a primeira observação da descoberta passa pelo parser da fonte
        # (A2). O preço genérico acima (primeiro match monetário) continua no
        # produto para descoberta/matching, mas o status do parser decide o
        # scrape_status da observação em tracked.py: partial nunca vira "ok".
        try:
            from app.etl.extract.marketplace import parsers as listing_parsers

            parsed = listing_parsers.parse(self.profile.source, content)
            source_specific["parser_version"] = parsed.parser_version
            source_specific["parser_scrape_status"] = parsed.scrape_status
        except ValueError:
            # Fonte ainda sem parser de acompanhamento: sem validação.
            source_specific["parser_version"] = f"{self.profile.source}@pending"
            source_specific["parser_scrape_status"] = "unknown"
        except Exception:
            source_specific["parser_version"] = f"{self.profile.source}@error"
            source_specific["parser_scrape_status"] = "unknown"
        observed_fields = ["url"]
        if candidate.get("title"):
            observed_fields.append("title")
        if candidate.get("description"):
            observed_fields.append("description")
        if price is not None:
            observed_fields.append("price_value")
        if images:
            observed_fields.append("image_urls")

        return {
            "source": self.profile.source,
            "record_id": extract_native_id(str(candidate["url"]), self.profile.source),
            "captured_at": datetime.now(timezone.utc).date().isoformat(),
            "title": str(candidate.get("title") or "").strip() or None,
            "url": candidate.get("url"),
            "source_page_url": candidate.get("url"),
            "image_url": images[0] if images else None,
            "image_urls": images,
            "price_value": price,
            "price_currency": currency,
            "description": candidate.get("description"),
            "collection_method": "Bright Data SERP API + Web Unlocker",
            "data_quality": "detail_scraped" if len(content) > 1000 else "search_snippet_only",
            "observed_fields": observed_fields,
            "source_specific": source_specific,
        }

    def extract(
        self,
        query: str,
        *,
        limit: int = 10,
        concurrency: int = 2,
        client: Optional[BrightDataClient] = None,
        candidate_filter: Optional[Callable[[Mapping[str, Any]], bool]] = None,
    ) -> dict[str, Any]:
        """Executa descoberta + detalhes e conserva erros parciais.

        `candidate_filter` recebe cada candidato e devolve True para raspar
        (ex.: pular URLs cujo `(source, native_id)` já está em
        `tracked_listings` na descoberta F1.4). Nenhum filtro por padrão.
        """

        active_client = client or self.client or BrightDataClient()
        effective_query = self.profile.build_query(query)
        search_response = active_client.search(effective_query, self.profile.country)
        discovered = self.discover_candidates(search_response, query)
        if candidate_filter is not None:
            candidates = [item for item in discovered if candidate_filter(item)]
            skipped = len(discovered) - len(candidates)
        else:
            candidates = discovered
            skipped = 0
        candidates = candidates[: max(1, limit)]
        records: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []

        def scrape(candidate: Mapping[str, Any]) -> dict[str, Any]:
            markdown = active_client.scrape(str(candidate["url"]), self.profile.country)
            record = self.parse_detail(candidate, markdown)
            record["collection_method"] = getattr(
                active_client,
                "collection_method",
                record["collection_method"],
            )
            record["source_specific"]["bright_data_provider"] = getattr(
                active_client,
                "provider",
                "test_or_custom",
            )
            return record

        workers = max(1, min(concurrency, len(candidates) or 1))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(scrape, candidate): candidate for candidate in candidates}
            for future in as_completed(futures):
                candidate = futures[future]
                try:
                    records.append(future.result())
                except Exception as error:  # partial output is intentional
                    errors.append({"url": str(candidate.get("url")), "error": str(error)})
                    fallback = self.parse_detail(candidate, "")
                    fallback["collection_method"] = getattr(
                        active_client,
                        "collection_method",
                        fallback["collection_method"],
                    )
                    fallback["source_specific"]["bright_data_provider"] = getattr(
                        active_client,
                        "provider",
                        "test_or_custom",
                    )
                    fallback["source_specific"]["detail_scrape_error"] = str(error)
                    records.append(fallback)

        records.sort(key=lambda item: str(item.get("record_id")))
        metadata = {
            "source": self.profile.source,
            "query": query,
            "country": self.profile.country,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "candidates_count": len(candidates),
            "records_count": len(records),
            "errors_count": len(errors),
            "provider": getattr(active_client, "provider", "test_or_custom"),
        }
        if candidate_filter is not None:
            metadata["tracked_skipped"] = skipped
        return {
            "metadata": metadata,
            "candidates": candidates,
            "records": records,
            "errors": errors,
        }


__all__ = [
    "BrightDataClient",
    "BrightDataMcpError",
    "BrightDataRequestError",
    "MarketplaceExtractor",
    "MarketplaceProfile",
]
