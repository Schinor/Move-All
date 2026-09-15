from datetime import date
import unittest
from unittest.mock import patch

from app.etl.extract.demand_signal.google_trends import GoogleTrendsExtractor, parse_bright_data_response
from app.etl.extract.demand_signal.tiktok_search import parse_tiktok_search_response
from app.etl.extract.marketplace.amazon_br import AmazonBRExtractor
from app.etl.extract.marketplace.common import BrightDataClient, MarketplaceExtractor, MarketplaceProfile
from app.etl.load.database import DemandSignalModel, ProductDemandLinkModel, ProductSnapshotModel, get_session
from app.etl.load.products import upsert_products
from app.etl.transform.correlate import build_product_demand_links
from app.etl.transform.normalize_demand import normalize_demand_records
from app.etl.transform.normalize_product import normalize_product
from app.etl.transform.extract_identifiers import canonical_title
from app.pipelines.run_live_intelligence import run as run_live_intelligence
from app.pipelines.run_weekly_intelligence import run as run_weekly_intelligence


def test_product_normalization_preserves_native_evidence():
    result = normalize_product(
        {
            "source": "Alibaba",
            "record_id": "abc-1",
            "captured_at": "2026-08-06",
            "title": "Elastic Resistance Bands Set",
            "cluster": "resistance bands",
            "price_value": 4.5,
            "price_currency": "USD",
            "moq": 10,
            "supplier_or_seller": "Supplier Ltd",
            "source_specific": {"faixas_preco": [{"min": 10, "preco": 4.5}]},
            "image_urls": ["https://example.test/image.jpg"],
        }
    )

    assert result["source"] == "alibaba"
    assert result["cluster"] == "resistance_bands"
    assert result["supplier"] == "Supplier Ltd"
    assert result["source_specific"]["faixas_preco"][0]["preco"] == 4.5
    assert result["source_specific"]["_raw_record_fields"]["image_urls"]


def test_entity_identity_normalizes_synonyms_units_and_identifiers():
    left, left_attrs = canonical_title("Halteres Ajustáveis Premium 20kg Par")
    right, right_attrs = canonical_title("Par de Dumbbell Adjustable 20 KG")
    assert left == right
    assert left_attrs["kg"] == right_attrs["kg"] == "20"

    normalized = normalize_product(
        {
            "source": "amazon_br",
            "record_id": "identity-1",
            "title": "Halter Ajustável Modelo XP-20 20kg",
            "source_specific": {"ean": "7891234567890", "brand": "Move Fit"},
        }
    )
    assert normalized["gtin"] == "7891234567890"
    assert normalized["brand"] == "move fit"
    assert normalized["attrs"]["model"] == "XP-20"
    assert normalized["attrs"]["kg"] == "20"


def test_demand_keeps_raw_values_without_rescaling():
    # F1.6: sem min-max por execução — trend_index = raw_value, para que
    # execuções diferentes sejam comparáveis e o histórico não seja reescrito.
    signals = normalize_demand_records(
        [
            {"keyword": "resistance bands", "geo": "US", "source": "google_trends", "week_start": "2026-08-03", "raw_value": 10, "captured_at": "2026-08-08"},
            {"keyword": "dumbbells", "geo": "US", "source": "google_trends", "week_start": "2026-08-03", "raw_value": 20, "captured_at": "2026-08-08"},
            {"keyword": "walking pad", "geo": "US", "source": "google_trends", "week_start": "2026-08-03", "raw_value": 30, "captured_at": "2026-08-08"},
        ]
    )
    by_keyword = {item["keyword"]: item["trend_index"] for item in signals}
    assert by_keyword == {"resistance bands": 10.0, "dumbbells": 20.0, "walking pad": 30.0}


def test_cluster_map_creates_auditable_links():
    product = normalize_product(
        {
            "source": "Amazon US",
            "record_id": "B000000001",
            "captured_at": "2026-08-06",
            "title": "Resistance Bands",
            "cluster": "resistance bands",
        }
    )
    demand = normalize_demand_records(
        [
            {"keyword": "resistance bands", "geo": "US", "source": "google_trends", "week_start": "2026-08-03", "raw_value": 20},
            {"keyword": "unrelated", "geo": "US", "source": "google_trends", "week_start": "2026-08-03", "raw_value": 30},
        ]
    )
    links = build_product_demand_links(
        [product],
        demand,
        {"resistance_bands": {"US": ["resistance bands"]}},
    )
    assert len(links) == 1
    assert links[0]["match_method"] == "cluster_map"
    assert links[0]["keyword"] == "resistance bands"


def test_bright_data_trends_parser_reads_timeline_data():
    records = parse_bright_data_response(
        {
            "widgets": [
                {
                    "data": {
                        "default": {
                            "timelineData": [
                                {"time": "2026-08-03", "value": [12]},
                                {"time": "2026-08-10", "value": [24]},
                            ]
                        }
                    }
                }
            ]
        },
        "resistance bands",
        "US",
    )
    assert [record["raw_value"] for record in records] == [12.0, 24.0]
    assert records[0]["source"] == "google_trends"

    class FakeBrightData:
        def google_trends(self, url):
            assert "brd_trends=timeseries" in url
            assert "brd_json=1" in url
            return {"timelineData": [{"time": "2026-08-03", "value": [12]}]}

    extracted = GoogleTrendsExtractor(client=FakeBrightData()).extract(
        ["resistance bands"], ["US"]
    )
    assert len(extracted) == 1


def test_trends_anchor_vai_na_mesma_requisicao_com_serie_propria():
    """A3.8: keyword + âncora na mesma requisição; âncora vira série própria."""

    class FakeAnchor:
        def __init__(self):
            self.urls: list[str] = []

        def google_trends(self, url):
            self.urls.append(url)
            return {
                "timelineData": [
                    {"time": "2026-08-03", "value": [20, 80]},
                    {"time": "2026-08-10", "value": [40, 90]},
                ]
            }

    client = FakeAnchor()
    extracted = GoogleTrendsExtractor(client=client).extract(
        ["haltere"], ["BR"], anchor_keyword="academia"
    )

    # Uma única requisição com os dois termos.
    assert len(client.urls) == 1
    assert "academia" in client.urls[0]
    keywords = sorted(record["keyword"] for record in extracted)
    assert keywords == ["academia", "academia", "haltere", "haltere"]
    assert {record["anchor_keyword"] for record in extracted} == {"academia"}


def test_trends_sem_serie_da_ancora_mantem_so_a_keyword():
    """A3.8: Bright Data sem a série da âncora → só crescimento por keyword."""

    class FakeSingle:
        def google_trends(self, url):
            return {"timelineData": [{"time": "2026-08-03", "value": [20]}]}

    extracted = GoogleTrendsExtractor(client=FakeSingle()).extract(
        ["haltere"], ["BR"], anchor_keyword="academia"
    )

    assert [record["keyword"] for record in extracted] == ["haltere"]
    assert extracted[0]["anchor_keyword"] == "academia"


def test_tiktok_search_is_separate_from_tiktok_shop():
    record = parse_tiktok_search_response(
        {"hashtag": {"video_count": "1.2M"}},
        "walking pad",
        "BR",
        date(2026, 8, 15),
    )
    assert record["source"] == "tiktok_search"
    assert record["raw_value"] == 1_200_000
    assert AmazonBRExtractor().profile.source == "amazon_br"


def test_marketplace_extractor_does_not_know_storage():
    profile = MarketplaceProfile(
        source="amazon_br",
        country="br",
        query_template="site:example.test {query}",
        accepted_url=__import__("re").compile(r"example\.test/item/"),
        default_currency="BRL",
    )
    extractor = MarketplaceExtractor(profile)
    candidates = extractor.discover_candidates(
        {"organic": [{"title": "Produto", "link": "https://example.test/item/1"}]},
        "produto",
    )
    assert candidates[0]["url"].endswith("/1")
    record = extractor.parse_detail(candidates[0], "Preço R$ 10,00")
    assert record["price_value"] == 10.0
    assert "session" not in extractor.__dict__


def test_bright_data_mcp_client_owns_session_and_unwraps_tool_result():
    class FakeResponse:
        def __init__(self, text, headers=None, status_code=200):
            self.text = text
            self.content = text.encode("utf-8")
            self.headers = headers or {}
            self.status_code = status_code
            self.ok = 200 <= status_code < 300

        def json(self):
            return __import__("json").loads(self.text)

    initialize = FakeResponse(
        'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n',
        {"content-type": "text/event-stream", "mcp-session-id": "test-session"},
    )
    initialized = FakeResponse("", {"content-type": "application/json"}, 202)
    tool_result = FakeResponse(
        'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"SECURITY NOTICE\\n=====UNTRUSTED_abc123_BEGIN=====\\n{\\"organic\\":[{\\"title\\":\\"Produto ajustável\\",\\"link\\":\\"https://example.test/item/1\\"}]}\\n=====UNTRUSTED_abc123_END====="}]}}\n',
        {"content-type": "text/event-stream"},
    )

    with patch(
        "app.etl.extract.marketplace.common.requests.post",
        side_effect=[initialize, initialized, tool_result],
    ) as request:
        client = BrightDataClient(provider="mcp", mcp_url="https://mcp.example.test/token")
        result = client.search("site:example.test produto", "br")

    assert result["organic"][0]["title"] == "Produto ajustável"
    assert request.call_count == 3
    assert request.call_args_list[1].kwargs["headers"]["Mcp-Session-Id"] == "test-session"
    assert request.call_args_list[2].kwargs["json"]["params"]["name"] == "search_engine"
    assert "Authorization" not in request.call_args_list[2].kwargs["headers"]


def test_product_loader_is_idempotent(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'etl.db'}"
    product = normalize_product(
        {
            "source": "1688",
            "record_id": "offer-1",
            "captured_at": "2026-08-06",
            "title": "Home Gym Equipment",
            "cluster": "home fitness equipment",
        }
    )
    first_session = get_session(database_url)
    try:
        upsert_products([product], session=first_session)
        first_session.commit()
    finally:
        first_session.close()

    second_session = get_session(database_url)
    try:
        upsert_products([product], session=second_session)
        second_session.commit()
        assert second_session.query(ProductSnapshotModel).count() == 1
    finally:
        second_session.close()


def test_live_pipeline_collects_persists_and_correlates_without_files(tmp_path):
    class FakeBrightData:
        def search(self, query, country):
            assert "amazon.com.br" in query
            assert country == "br"
            return {
                "organic": [
                    {
                        "title": "Kit Halteres Ajustáveis",
                        "description": "Treino em casa por R$ 199,90",
                        "link": "https://www.amazon.com.br/dp/B000000001",
                    }
                ]
            }

        def scrape(self, url, country):
            if "tiktok.com/tag" in url:
                return "1.2M videos"
            return "# Kit Halteres\nPreço R$ 199,90\n" + ("produto fitness " * 100)

        def google_trends(self, url):
            assert "brd_trends=timeseries" in url
            return {
                "timelineData": [
                    {"time": "2026-08-03", "value": [20]},
                    {"time": "2026-08-10", "value": [40]},
                ]
            }

    database_url = f"sqlite:///{tmp_path / 'live.db'}"
    result = run_live_intelligence(
        term="haltere ajustável",
        sources=["amazon_br"],
        limit=1,
        geos=["BR"],
        include_demand=True,
        database_url=database_url,
        client=FakeBrightData(),
        window_days=30,
    )

    assert result["products"] == 1
    assert result["demand_signals"] == 3
    assert result["product_demand_links"] == 3
    session = get_session(database_url)
    try:
        assert session.query(ProductSnapshotModel).count() == 1
        assert session.query(DemandSignalModel).count() == 3
        assert session.query(ProductDemandLinkModel).count() == 3
    finally:
        session.close()


def test_weekly_pipeline_walks_keyword_variants_and_upserts(tmp_path):
    class FakeBrightData:
        provider = "test"

        def search(self, query, country):
            return {
                "organic": [
                    {
                        "title": "Kit Halteres Ajustáveis",
                        "description": "Treino em casa por R$ 199,90",
                        "link": "https://www.amazon.com.br/dp/B000000001",
                    }
                ]
            }

        def scrape(self, url, country):
            return "# Kit Halteres\nPreço R$ 199,90\n" + ("produto fitness " * 100)

    keyword_map = tmp_path / "keywords.yaml"
    keyword_map.write_text(
        """clusters:
  dumbbells:
    keywords:
      BR: [\"haltere ajustável\", \"kit halteres\"]
      US: [\"adjustable dumbbells\", \"dumbbell set\"]
""",
        encoding="utf-8",
    )
    database_url = f"sqlite:///{tmp_path / 'weekly.db'}"
    result = run_weekly_intelligence(
        sources=["amazon_br"],
        limit=1,
        geos=["BR"],
        include_demand=False,
        database_url=database_url,
        keyword_map_path=keyword_map,
        clusters=["dumbbells"],
        keyword_depth="all",
        client=FakeBrightData(),
    )

    assert result["terms_requested"] == 2
    assert result["terms_completed"] == 2
    # F1.4: a 2ª variante encontra o mesmo anúncio já registrado pela 1ª e não
    # raspa de novo (dedup por tracked_listings) — por isso 1 produto, não 2.
    assert result["products"] == 1
    assert result["unique_products"] == 1
    session = get_session(database_url)
    try:
        assert session.query(ProductSnapshotModel).count() == 1
        stored = session.query(ProductSnapshotModel).one()
        # F1.4: a variante 1 foi dedupada (não persistiu), então vale a 0.
        assert stored.source_specific["keyword_variant"] == 0
        assert stored.source_specific["collection_window_start"]
    finally:
        session.close()


class TestIntelligenceETL(unittest.TestCase):
    """Também permite executar os contratos sem instalar pytest."""

    def test_contracts_without_pytest(self):
        test_product_normalization_preserves_native_evidence()
        test_entity_identity_normalizes_synonyms_units_and_identifiers()
        test_demand_keeps_raw_values_without_rescaling()
        test_cluster_map_creates_auditable_links()
        test_bright_data_trends_parser_reads_timeline_data()
        test_tiktok_search_is_separate_from_tiktok_shop()
        test_marketplace_extractor_does_not_know_storage()
        test_bright_data_mcp_client_owns_session_and_unwraps_tool_result()

    def test_loader_without_pytest(self):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            test_product_loader_is_idempotent(Path(directory))
            test_live_pipeline_collects_persists_and_correlates_without_files(Path(directory))
            test_weekly_pipeline_walks_keyword_variants_and_upserts(Path(directory))
