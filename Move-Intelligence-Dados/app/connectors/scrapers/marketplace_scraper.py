import os
import yaml
import logging
from typing import List, Dict
from .base_scraper import BaseScraper
from app.etl.transform.normalize_product import is_fitness_product

class MarketplaceScraper(BaseScraper):
    def __init__(self):
        super().__init__(delay_seconds=2.0, timeout=15)
        self._load_config()

    def _load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), '../../../configs/sources.yml')
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = yaml.safe_load(f)
                    scraper_config = config.get('scrapers', {}).get('marketplace', {})
                    self.delay_seconds = scraper_config.get('request_delay_seconds', self.delay_seconds)
                    self.timeout = scraper_config.get('timeout', self.timeout)
            except Exception as e:
                logging.error(f"Erro ao carregar configuracao de MarketplaceScraper: {e}")

    def scrape(self, query: str) -> List[Dict]:
        """
        Gera e raspa os resultados de uma busca no marketplace.
        Retorna apenas anúncios reais validados e restritos ao ramo fitness.
        Sem fallbacks silenciosos ou mocks — falhas são explícitas.
        """
        search_url = f"https://www.mercadolivre.com.br/jm/search?as_word={query}"
        html_content = self.fetch_page(search_url)
        
        if not html_content:
            logging.warning(f"Nenhum conteúdo retornado pelo servidor para consulta '{query}'.")
            return []

        soup = self.get_soup(html_content)
        results = []

        # Tenta parsear a estrutura de itens de busca
        items = soup.select(".ui-search-result__wrapper") or soup.select(".ui-search-layout__item")
        
        if not items:
            logging.info(f"Nenhum anúncio encontrado com seletores CSS na página para '{query}'.")
            return []

        for idx, item in enumerate(items):
            try:
                title_el = item.select_one(".ui-search-item__title")
                price_el = item.select_one(".price-tag-amount") or item.select_one(".ui-search-price__part")
                link_el = item.select_one("a.ui-search-link")

                if not title_el or not price_el:
                    continue

                title = title_el.text.strip()
                
                # REGRA CRÍTICA: Os scrapers devem somente aceitar produtos fitness
                if not is_fitness_product({"title": title}):
                    logging.debug(f"Item descartado por não pertencer ao ramo fitness: {title}")
                    continue

                price_text = price_el.text.strip()
                link = link_el['href'] if link_el else "#"
                
                results.append({
                    "source_id": f"scraped_{query.replace(' ', '_')}_{idx}",
                    "title": title,
                    "url": link,
                    "price_raw": price_text,
                    "currency": "BRL",
                    "rating": None,
                    "reviews_count": None
                })
            except Exception as e:
                logging.error(f"Erro ao parsear elemento #{idx} no MarketplaceScraper: {e}")

        return results
