import unittest
import sys
import os

# Adiciona o diretório raiz ao path para encontrar o app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.etl.normalize_text import clean_text
from app.etl.normalize_price import parse_price
from app.etl.normalize_currency import convert_to_brl
from app.etl.entity_resolution import calculate_jaccard_similarity, resolve_product

# tests/test_marketplace_ids.py segue o padrão pytest (funções soltas, sem
# unittest.TestCase) usado em tests/test_fitness_scope.py. Este runner não faz
# descoberta automática de arquivos: só executa o que está definido/importado
# neste módulo. Por isso os testes de identidade de anúncio (Shopee/Mercado
# Livre) são importados e chamados explicitamente abaixo, dentro de
# TestMarketplaceIds, para garantir que rodem via `python3 tests/run_tests.py`.
from test_marketplace_ids import (
    test_mercado_livre_catalog_url_matches_listing_id_format,
    test_mercado_livre_extracts_id_with_querystring,
    test_mercado_livre_is_stable_when_seller_edits_the_title,
    test_mercado_livre_normalizes_listing_url_with_title_slug,
    test_shopee_alternate_product_url_format,
    test_shopee_distinguishes_products_from_the_same_shop,
    test_shopee_extracts_item_id_not_shop_id,
    test_shopee_extracts_item_id_with_querystring,
)

class TestETLAndScoring(unittest.TestCase):
    # Nota F2.7: os testes do scoring legado (trend/financial/recommendation/
    # monte_carlo em app/scoring) foram removidos junto com o código — o score
    # oficial agora é o Move Score (lote Monte Carlo + ProductScore).

    def test_clean_text(self):
        self.assertEqual(clean_text("   <b>Haltere</b> &amp; Barra   "), "haltere & barra")
        self.assertEqual(clean_text("<p>Esteira Ergométrica</p>", lowercase=False), "Esteira Ergométrica")
        self.assertEqual(clean_text(None), "")
        
    def test_parse_price(self):
        self.assertEqual(parse_price("R$ 1.500,50"), 1500.50)
        self.assertEqual(parse_price("US$ 1,200.00"), 1200.00)
        self.assertEqual(parse_price("150,00"), 150.00)
        self.assertEqual(parse_price("Free"), 0.0)
        
    def test_convert_to_brl(self):
        rates = {"USD": 1.0, "BRL": 5.0, "EUR": 0.9}
        # 100 EUR -> 100 / 0.9 = 111.11 USD -> 111.11 * 5 = 555.56 BRL
        self.assertAlmostEqual(convert_to_brl(100.0, "EUR", rates), 555.56, places=2)
        self.assertEqual(convert_to_brl(150.0, "BRL", rates), 150.0)
        
    def test_jaccard_similarity(self):
        sim = calculate_jaccard_similarity("Haltere Ajustavel Movement 24kg", "Haltere Ajustavel Movement 24kg Preto")
        self.assertGreater(sim, 0.4)
        
        # Semelhança baixa
        sim_low = calculate_jaccard_similarity("Haltere Movement", "Esteira Kikos")
        self.assertLess(sim_low, 0.1)
        
    def test_resolve_product(self):
        existing = [
            {"id": "prod-1", "title": "Haltere Ajustavel Movement 24kg"},
            {"id": "prod-2", "title": "Esteira Ergometrica Dobravel Kikos"}
        ]
        resolved = resolve_product("Haltere Ajustavel Movement 24kg Emborrachado", existing, threshold=0.4)
        self.assertEqual(resolved, "prod-1")
        
        resolved_none = resolve_product("Bicicleta Spinning Speedo", existing, threshold=0.4)
        self.assertIsNone(resolved_none)


class TestMarketplaceIds(unittest.TestCase):
    """Regressão do ID instável de anúncio (Shopee/Mercado Livre) -- ver
    RELATORIO_ANALISE_DADOS_E_SCORES.md, seção 2.1 A3."""

    def test_shopee_id_extraction(self):
        test_shopee_extracts_item_id_not_shop_id()
        test_shopee_distinguishes_products_from_the_same_shop()
        test_shopee_extracts_item_id_with_querystring()
        test_shopee_alternate_product_url_format()

    def test_mercado_livre_id_extraction(self):
        test_mercado_livre_normalizes_listing_url_with_title_slug()
        test_mercado_livre_is_stable_when_seller_edits_the_title()
        test_mercado_livre_catalog_url_matches_listing_id_format()
        test_mercado_livre_extracts_id_with_querystring()


if __name__ == '__main__':
    unittest.main()
