import os
import yaml
import uuid
import json
import logging
from app.connectors.apis.mercado_livre import MercadoLivreAPI
from app.connectors.apis.google_trends import GoogleTrendsAPI
from app.storage.database import SessionLocal, RawRecordModel, init_db
from app.storage.raw_storage import save_raw_payload

def run():
    logging.info("Iniciando pipeline de coleta via APIs...")
    init_db() # garante tabelas inicializadas
    
    # 1. Carregar palavras-chave
    keywords_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../configs/product_keywords.yml'))
    if not os.path.exists(keywords_path):
        logging.error(f"Arquivo de palavras-chave nao encontrado em {keywords_path}")
        return
        
    with open(keywords_path, 'r', encoding='utf-8') as f:
        keywords_config = yaml.safe_load(f)
        
    categories = keywords_config.get('categories', [])
    
    # Instanciar APIs
    ml_api = MercadoLivreAPI()
    gt_api = GoogleTrendsAPI()
    
    db = SessionLocal()
    
    try:
        for cat in categories:
            cat_name = cat.get('name', 'geral')
            keywords = cat.get('keywords', [])
            
            for kw in keywords:
                logging.info(f"Processando palavra-chave: {kw} (Categoria: {cat_name})")
                
                # --- MERCADO LIVRE API ---
                ml_res = ml_api.search_items(kw, limit=10)
                ml_payload_str = json.dumps(ml_res, ensure_ascii=False)
                ml_id = str(uuid.uuid4())
                
                # Salva em disco
                save_raw_payload(f"ml_{ml_id}.json", ml_payload_str, subfolder="mercado_livre")
                
                # Salva no Banco de Dados usando ORM
                db_record_ml = RawRecordModel(
                    id=ml_id,
                    source="mercado_livre",
                    endpoint="/sites/MLB/search",
                    query_params=json.dumps({"q": kw}),
                    payload=ml_payload_str
                )
                db.add(db_record_ml)
                
                # --- GOOGLE TRENDS API ---
                gt_res = gt_api.get_interest_over_time(kw)
                gt_payload_str = json.dumps(gt_res, ensure_ascii=False)
                gt_id = str(uuid.uuid4())
                
                # Salva em disco
                save_raw_payload(f"gt_{gt_id}.json", gt_payload_str, subfolder="google_trends")
                
                # Salva no Banco
                db_record_gt = RawRecordModel(
                    id=gt_id,
                    source="google_trends",
                    endpoint="/trends/api/explore",
                    query_params=json.dumps({"keyword": kw}),
                    payload=gt_payload_str
                )
                db.add(db_record_gt)
                
        db.commit()
        logging.info("Coleta via APIs concluida e persistida com sucesso.")
    except Exception as e:
        db.rollback()
        logging.error(f"Erro fatal na pipeline de APIs: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run()
