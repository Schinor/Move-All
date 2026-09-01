import logging
from app.storage.database import SessionLocal, ProductModel, ListingModel, init_db

def run():
    logging.info("Iniciando pipeline de calculo de metricas...")
    init_db()
    
    db = SessionLocal()
    
    try:
        products = db.query(ProductModel).all()
        logging.info(f"Processando metricas de precos para {len(products)} produtos.")
        
        for product in products:
            # Seleciona todos os anuncios vinculados ao produto
            listings = db.query(ListingModel).filter_by(product_id=product.id).all()
            
            if listings:
                prices = [l.price for l in listings if l.price > 0]
                if prices:
                    avg_price = sum(prices) / len(prices)
                    product.average_price = round(avg_price, 2)
                    
                    # Estima o custo de fornecedor caso ainda seja o default original
                    # Propomos que o custo do fornecedor seja em media 70% do menor preco praticado no mercado
                    min_price = min(prices)
                    product.base_cost = round(min_price * 0.7, 2)
                    logging.info(f"Produto '{product.title}' atualizado: Preco Medio = R$ {product.average_price:.2f}, Preco Base Custo = R$ {product.base_cost:.2f}")
            else:
                logging.info(f"Nenhum anuncio vinculado ao produto '{product.title}'. Metricas inalteradas.")
                
        db.commit()
        logging.info("Calculo de metricas concluido com sucesso.")
    except Exception as e:
        db.rollback()
        logging.error(f"Erro fatal na pipeline de Metricas: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run()
