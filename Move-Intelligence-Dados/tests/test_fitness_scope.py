from app.etl.transform.normalize_product import is_fitness_product, normalize_products
from app.etl.normalize_product import extract_attributes
from app.connectors.scrapers.marketplace_scraper import MarketplaceScraper
from app.connectors.scrapers.supplier_scraper import SupplierScraper


def test_normalize_products_drops_explicit_non_fitness_contamination():
    records = [
        {
            "source": "amazon",
            "record_id": "headphone-1",
            "captured_at": "2026-08-20",
            "title": "JBL Fone de Ouvido Esportivo Sem Fio",
            "cluster": "home_fitness_equipment",
        },
        {
            "source": "amazon",
            "record_id": "tool-1",
            "captured_at": "2026-08-20",
            "title": "Parafusadeira Furadeira de Impacto Bosch 18V",
            "cluster": "home_fitness_equipment",
        },
        {
            "source": "amazon",
            "record_id": "robot-1",
            "captured_at": "2026-08-20",
            "title": "Aspirador Robô Inteligente com Conexão Alexa",
            "cluster": "home_fitness_equipment",
        },
        {
            "source": "amazon",
            "record_id": "fitness-1",
            "captured_at": "2026-08-20",
            "title": "Adjustable Dumbbell Set 24kg",
            "cluster": "dumbbells",
        },
    ]

    products = normalize_products(records)

    assert [product["record_id"] for product in products] == ["fitness-1"]


def test_normalize_products_keeps_fitness_signal_without_cluster():
    records = [
        {
            "source": "tiktok_shop",
            "record_id": "miniband-1",
            "captured_at": "2026-08-20",
            "title": "Miniband de resistência para treino",
        }
    ]

    products = normalize_products(records)

    assert len(products) == 1
    assert products[0]["cluster"] == "resistance_bands"


def test_is_fitness_product_accepts_residential_and_commercial_fitness():
    # Residencial
    assert is_fitness_product("Esteira Elétrica Dobrável Walking Pad 110V")
    assert is_fitness_product("Kit Halteres Sextavados Emborrachados 10kg")
    assert is_fitness_product("Faixa Elástica Super Band Treino Funcional")
    assert is_fitness_product("Tapete de Yoga Mat EVA 10mm Antiderrapante")
    assert is_fitness_product("Pistola Massageadora Percussiva Muscular")

    # Comercial / Academia Profissional
    assert is_fitness_product("Leg Press 45 Graus Linha Profissional Academia")
    assert is_fitness_product("Smith Machine Academia Tubo Reforçado")
    assert is_fitness_product("Gaiola de Agachamento Power Rack Crossfit")
    assert is_fitness_product("Bicicleta Spinning Profissional Roda de Inércia 18kg")
    assert is_fitness_product("Simulador de Escada Ergométrica Comercial")

    # Não-fitness (devem ser rejeitados)
    assert not is_fitness_product("Smartphone Galaxy S24 Ultra 256GB")
    assert not is_fitness_product("Parafusadeira e Furadeira Bateria")
    assert not is_fitness_product("Notebook Dell Inspiron i7 16GB")
    assert not is_fitness_product("Fechadura Digital Biométrica Inteligente")
    assert not is_fitness_product("Fone de Ouvido Bluetooth Sem Fio")


def test_marketplace_scraper_returns_no_fake_mock_on_empty_page():
    scraper = MarketplaceScraper()
    # Scrape em query vazia ou sem retorno não deve gerar dados mockados silenciosamente
    results = scraper.scrape("")
    assert isinstance(results, list)
    for item in results:
        assert is_fitness_product(item["title"])


def test_supplier_scraper_returns_no_fake_mock_on_failed_url():
    scraper = SupplierScraper()
    # Em caso de falha de conexão, não deve injetar mock fictício
    results = scraper.scrape("https://unreachable-supplier-fake-test.local/produtos")
    assert isinstance(results, list)
    for item in results:
        assert is_fitness_product(item["title"])


def test_extract_attributes_fitness_specs():
    specs = extract_attributes("Haltere Sextavado Movement 24kg Emborrachado")
    assert specs["brand"] == "Movement"
    assert specs["specifications"].get("weight") == "24 KG"

    specs_mat = extract_attributes("Tapete de Yoga Kikos 10mm Antiderrapante")
    assert specs_mat["brand"] == "Kikos"
    assert specs_mat["specifications"].get("thickness") == "10 MM"
