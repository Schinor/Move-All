import json
import logging
from app.storage.database import SessionLocal, ProductModel, RawRecordModel, init_db
from app.scoring import (
    calculate_trend_score, calculate_financial_metrics,
    run_profitability_simulation, generate_recommendation
)

def run():
    logging.info("Iniciando pipeline de calculo de scores e tomada de decisao...")
    init_db()
    
    db = SessionLocal()
    
    try:
        products = db.query(ProductModel).all()
        logging.info(f"Executando pontuacao e simulacao para {len(products)} produtos.")
        
        for product in products:
            # 1. Obter dados de tendencia de busca (Google Trends)
            # Encontra registros brutos de Google Trends para o produto com base em correspondencia de titulo
            # ou palavra-chave (usando busca de substring simples)
            keyword_clean = product.title.split()[0].lower() # simplificacao para obter primeira palavra
            
            trend_record = db.query(RawRecordModel).filter(
                RawRecordModel.source == "google_trends",
                RawRecordModel.query_params.like(f"%{keyword_clean}%")
            ).first()
            
            trend_data = []
            if trend_record:
                try:
                    trend_data = json.loads(trend_record.payload)
                except Exception as e:
                    logging.error(f"Erro ao carregar dados de tendencia do registro {trend_record.id}: {e}")
            
            # Calcular Trend Score
            t_score = calculate_trend_score(trend_data)
            
            # 2. Calcular scores financeiros
            fin_metrics = calculate_financial_metrics(product.average_price, product.base_cost)
            f_score = fin_metrics["financial_score"]
            
            # 3. Executar Simulacao de Monte Carlo para avaliar probabilidade de prejuizo
            # Demanda esperada: 100 unidades, std_dev: 30
            # Preco de venda medio: product.average_price, std_dev: 15% do preco medio
            std_price = max(1.0, product.average_price * 0.15)
            mc_sim = run_profitability_simulation(
                unit_cost=product.base_cost,
                mean_sale_price=product.average_price,
                price_std_dev=std_price,
                mean_demand=100.0,
                demand_std_dev=30.0
            )
            
            loss_prob = mc_sim["loss_probability"]
            
            # 4. Compilar recomendacao final
            rec = generate_recommendation(t_score, f_score, loss_prob)
            
            print(f"\n=========================================")
            print(f"PRODUTO: {product.title}")
            print(f"SKU: {product.sku}")
            print(f"Preço Médio: R$ {product.average_price:.2f} | Custo Base: R$ {product.base_cost:.2f}")
            print(f"Margem Bruta: {fin_metrics['gross_margin']}% | ROI Estimado: {fin_metrics['estimated_roi']}%")
            print(f"Trend Score: {t_score} | Financial Score: {f_score}")
            print(f"Simulacao de Monte Carlo (Lucro Medio): R$ {mc_sim['mean_profit']:.2f}")
            print(f"Probabilidade de Prejuízo: {loss_prob}% | VaR 95%: R$ {mc_sim['value_at_risk_95']:.2f}")
            print(f"DECISÃO RECOMENDADA: {rec['decision']}")
            print(f"Justificativa: {rec['justification']}")
            print(f"=========================================")
            
        logging.info("Pipeline de scores concluida com sucesso.")
    except Exception as e:
        logging.error(f"Erro fatal na pipeline de Scores: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run()
