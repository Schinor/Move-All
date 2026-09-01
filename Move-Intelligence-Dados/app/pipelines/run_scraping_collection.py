import os
import yaml
import uuid
import json
import logging
from app.connectors.scrapers.marketplace_scraper import MarketplaceScraper
from app.connectors.scrapers.supplier_scraper import SupplierScraper
from app.storage.database import SessionLocal, RawRecordModel, init_db
from app.storage.raw_storage import save_raw_payload

def run():
    logging.info("Iniciando pipeline de coleta via Scrapers...")
    init_db()
    
    keywords_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../configs/product_keywords.yml'))
    if not os.path.exists(keywords_path):
        logging.error(f"Arquivo de palavras-chave nao encontrado em {keywords_path}")
        return
        
    with open(keywords_path, 'r', encoding='utf-8') as f:
        keywords_config = yaml.safe_load(f)
        
    categories = keywords_config.get('categories', [])
    
    mp_scraper = MarketplaceScraper()
    sp_scraper = SupplierScraper()
    
    db = SessionLocal()
    
    try:
        # 1. Scrape de Marketplace
        for cat in categories:
            keywords = cat.get('keywords', [])
            for kw in keywords:
                logging.info(f"Disparando Marketplace Scraper para: {kw}")
                mp_res = mp_scraper.scrape(kw)
                mp_payload_str = json.dumps(mp_res, ensure_ascii=False)
                mp_id = str(uuid.uuid4())
                
                # Salva em disco
                save_raw_payload(f"mp_{mp_id}.json", mp_payload_str, subfolder="marketplace_scraper")
                
                # Salva no DB
                db_record_mp = RawRecordModel(
                    id=mp_id,
                    source="marketplace_scraper",
                    endpoint="marketplace_search",
                    query_params=json.dumps({"q": kw}),
                    payload=mp_payload_str
                )
                db.add(db_record_mp)
                
        # 2. Scrape de Fornecedores (com URLs simuladas baseadas em categorias)
        # Em cenario real, carregariamos URLs de fornecedores cadastrados
        mock_supplier_urls = [
            "https://fornecedorequipamentosfitness.com.br/produtos",
            "https://distribuidoraacademiapro.com.br/catalogo"
        ]
        
        for url in mock_supplier_urls:
            logging.info(f"Disparando Supplier Scraper para: {url}")
            sp_res = sp_scraper.scrape(url)
            sp_payload_str = json.dumps(sp_res, ensure_ascii=False)
            sp_id = str(uuid.uuid4())
            
            # Salva em disco
            save_raw_payload(f"sp_{sp_id}.json", sp_payload_str, subfolder="supplier_scraper")
            
            # Salva no DB
            db_record_sp = RawRecordModel(
                id=sp_id,
                source="supplier_scraper",
                endpoint=url,
                query_params=json.dumps({"url": url}),
                payload=sp_payload_str
            )
            db.add(db_record_sp)
            
        db.commit()
        logging.info("Coleta via Scrapers concluida e persistida com sucesso.")
    except Exception as e:
        db.rollback()
        logging.error(f"Erro fatal na pipeline de Scrapers: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run()
