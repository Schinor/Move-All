import json
import logging
import uuid
from typing import List, Dict
from app.storage.database import SessionLocal, RawRecordModel, ProductModel, ListingModel, SupplierModel, init_db
from app.connectors.apis.exchange_rate import ExchangeRateAPI
from app.etl import (
    clean_text, parse_price, convert_to_brl,
    extract_attributes, deduplicate_listings, resolve_product
)

def run():
    logging.info("Iniciando pipeline de processamento ETL...")
    init_db()
    
    db = SessionLocal()
    er_api = ExchangeRateAPI()
    
    try:
        # 1. Carregar taxas de cambio mais recentes para BRL
        exchange_rates = er_api.get_latest_rates(base_currency="USD")
        
        # 2. Obter registros brutos nao processados (aqui simulamos processamento completo)
        raw_records = db.query(RawRecordModel).all()
        logging.info(f"Encontrados {len(raw_records)} registros brutos para processamento.")
        
        listings_to_process = []
        suppliers_to_process = []
        
        # Parse inicial de payloads
        for rec in raw_records:
            try:
                payload_data = json.loads(rec.payload)
                
                if rec.source == "mercado_livre":
                    results = payload_data.get("results", [])
                    for item in results:
                        listings_to_process.append({
                            "source_name": "mercado_livre",
                            "source_id": str(item.get("id")),
                            "title": clean_text(item.get("title", "")),
                            "url": item.get("permalink", ""),
                            "price_raw": str(item.get("price", "0.0")),
                            "currency": item.get("currency_id", "BRL"),
                            "rating": item.get("reviews", {}).get("rating", None),
                            "reviews_count": item.get("reviews", {}).get("total", 0),
                            "raw_record_id": rec.id
                        })
                        
                elif rec.source == "marketplace_scraper":
                    # Os dados vindos do scraper ja vem em lista estruturada
                    for item in payload_data:
                        listings_to_process.append({
                            "source_name": "marketplace_scraper",
                            "source_id": item.get("source_id"),
                            "title": clean_text(item.get("title", "")),
                            "url": item.get("url", ""),
                            "price_raw": item.get("price_raw", "0.0"),
                            "currency": item.get("currency", "BRL"),
                            "rating": item.get("rating", None),
                            "reviews_count": item.get("reviews_count", 0),
                            "raw_record_id": rec.id
                        })
                        
                elif rec.source == "supplier_scraper":
                    # Fornecedores
                    for item in payload_data:
                        suppliers_to_process.append({
                            "source_id": item.get("supplier_item_id"),
                            "title": clean_text(item.get("title", "")),
                            "price_raw": item.get("price_raw", "0.0"),
                            "url": item.get("url", ""),
                            "raw_record_id": rec.id
                        })
            except Exception as e:
                logging.error(f"Erro ao analisar payload do registro {rec.id}: {e}")
                
        # 3. Executar deduplicacao de listings e filtro restrito ao ramo fitness
        from app.etl.transform.normalize_product import is_fitness_product
        unique_listings = [
            item for item in deduplicate_listings(listings_to_process)
            if is_fitness_product({"title": item.get("title", "")})
        ]
        logging.info(f"Deduplicacao e filtro fitness resultaram em {len(unique_listings)} listings validas.")
        
        # 4. Entity Resolution & Persistencia
        # Carrega produtos existentes para resolver entidades
        existing_products = [{"id": p.id, "title": p.title} for p in db.query(ProductModel).all()]
        
        for item in unique_listings:
            # Normalizar preço e moeda
            raw_price = parse_price(item["price_raw"])
            normalized_price = convert_to_brl(raw_price, item["currency"], exchange_rates)
            
            # Entity Resolution
            matched_product_id = resolve_product(item["title"], existing_products, threshold=0.45)
            
            if not matched_product_id:
                # Criar novo produto consolidado de referencia
                matched_product_id = str(uuid.uuid4())
                attrs = extract_attributes(item["title"])
                
                new_product = ProductModel(
                    id=matched_product_id,
                    title=item["title"].title(),
                    sku=f"SKU-{matched_product_id[:8].upper()}",
                    category=attrs.get("brand", "Geral"),
                    average_price=normalized_price,
                    base_cost=normalized_price * 0.7 # estimativa inicial
                )
                db.add(new_product)
                existing_products.append({"id": matched_product_id, "title": item["title"]})
                
            # Verifica se a listagem ja existe no banco para evitar duplicidade de PK
            listing_id = f"lst_{item['source_name']}_{item['source_id']}"
            db_listing = db.query(ListingModel).filter_by(id=listing_id).first()
            
            if not db_listing:
                db_listing = ListingModel(
                    id=listing_id,
                    source_name=item["source_name"],
                    source_id=item["source_id"],
                    title=item["title"],
                    url=item["url"],
                    price=normalized_price,
                    currency="BRL",
                    rating=item["rating"],
                    reviews_count=item["reviews_count"],
                    raw_record_id=item["raw_record_id"],
                    product_id=matched_product_id
                )
                db.add(db_listing)
            else:
                # Atualiza preco
                db_listing.price = normalized_price
                db_listing.product_id = matched_product_id
                
        # 5. Processar fornecedores e preencher tabela de Fornecedores
        for sup in suppliers_to_process:
            sup_id = f"sup_{sup['source_id']}"
            db_sup = db.query(SupplierModel).filter_by(id=sup_id).first()
            if not db_sup:
                # Extrair nome do dominio como nome do fornecedor
                domain_name = sup["url"].split("//")[-1].split("/")[0]
                db_sup = SupplierModel(
                    id=sup_id,
                    name=domain_name,
                    website=sup["url"],
                    contact_info="Contato via portal web",
                    rating=4.0
                )
                db.add(db_sup)
                
        db.commit()
        logging.info("Pipeline ETL concluido com sucesso. Anuncios e produtos sincronizados.")
    except Exception as e:
        db.rollback()
        logging.error(f"Erro fatal na pipeline ETL: {e}")
    finally:
        db.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    run()
