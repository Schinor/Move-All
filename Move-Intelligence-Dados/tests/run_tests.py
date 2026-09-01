import unittest
import sys
import os

# Adiciona o diretório raiz ao path para encontrar o app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.etl.normalize_text import clean_text
from app.etl.normalize_price import parse_price
from app.etl.normalize_currency import convert_to_brl
from app.etl.entity_resolution import calculate_jaccard_similarity, resolve_product
from app.scoring.trend_score import calculate_trend_score
from app.scoring.financial_score import calculate_financial_metrics
from app.scoring.recommendation import generate_recommendation
from app.scoring.monte_carlo import run_profitability_simulation

class TestETLAndScoring(unittest.TestCase):
    
    def test_monte_carlo_simulation(self):
        sim = run_profitability_simulation(
            unit_cost=100.0,
            mean_sale_price=150.0,
            price_std_dev=10.0,
            mean_demand=50.0,
            demand_std_dev=5.0,
            simulations_count=100
        )
        self.assertIn("mean_profit", sim)
        self.assertIn("loss_probability", sim)
        self.assertGreater(sim["mean_profit"], 0.0)

    
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
        
    def test_trend_score(self):
        # Tendência de alta
        up_trend = [{"value": 20 + i*5} for i in range(10)]
        score_up = calculate_trend_score(up_trend)
        self.assertGreater(score_up, 50.0)
        
        # Tendência de queda
        down_trend = [{"value": 80 - i*6} for i in range(10)]
        score_down = calculate_trend_score(down_trend)
        self.assertLess(score_down, 50.0)
        
    def test_financial_score(self):
        metrics = calculate_financial_metrics(100.0, 70.0) # Margem = 30%, ROI = 42.8%
        self.assertGreater(metrics["financial_score"], 60.0)
        self.assertAlmostEqual(metrics["gross_margin"], 30.0)
        
    def test_recommendation(self):
        rec = generate_recommendation(80.0, 75.0, 5.0)
        self.assertEqual(rec["decision"], "Comprar")
        
        rec_discard = generate_recommendation(20.0, 30.0, 45.0)
        self.assertEqual(rec_discard["decision"], "Descartar")

if __name__ == '__main__':
    unittest.main()
