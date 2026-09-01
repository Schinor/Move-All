import os
import yaml
import logging
from typing import List, Dict
from .base_scraper import BaseScraper
from app.etl.transform.normalize_product import is_fitness_product

class SupplierScraper(BaseScraper):
    def __init__(self):
        super().__init__(delay_seconds=3.0, timeout=20)
        self._load_config()

    def _load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), '../../../configs/sources.yml')
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = yaml.safe_load(f)
                    scraper_config = config.get('scrapers', {}).get('supplier', {})
                    self.delay_seconds = scraper_config.get('request_delay_seconds', self.delay_seconds)
                    self.timeout = scraper_config.get('timeout', self.timeout)
            except Exception as e:
                logging.error(f"Erro ao carregar configuracoes de SupplierScraper: {e}")

    def scrape(self, supplier_url: str) -> List[Dict]:
        """
        Coleta dados de produtos de um fornecedor específico usando Playwright/BeautifulSoup.
        Filtra estritamente produtos do segmento Fitness (residencial e comercial).
        Sem mocks ou dados falsos — falhas na coleta retornam lista vazia com log explícito.
        """
        logging.info(f"Iniciando scrape de fornecedor fitness: {supplier_url}")
        
        products = []
        
        try:
            from playwright.sync_api import sync_playwright
            
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    user_agent=self.user_agents[0],
                    viewport={"width": 1280, "height": 800}
                )
                page = context.new_page()
                page.goto(supplier_url, timeout=self.timeout * 1000)
                page.wait_for_timeout(2000)
                
                html_content = page.content()
                soup = self.get_soup(html_content)
                items = soup.select(".product-card") or soup.select(".item-box")
                
                for idx, item in enumerate(items):
                    title_el = item.select_one(".product-title") or item.select_one("h3")
                    price_el = item.select_one(".product-price") or item.select_one(".price")
                    
                    if not title_el or not price_el:
                        continue

                    title = title_el.text.strip()
                    
                    if not is_fitness_product({"title": title}):
                        continue

                    price_str = price_el.text.strip()
                    
                    products.append({
                        "supplier_item_id": f"sup_item_{idx}",
                        "title": title,
                        "price_raw": price_str,
                        "url": supplier_url
                    })
                
                browser.close()
        except ImportError:
            logging.warning("Playwright nao instalado no ambiente. Usando extrator BeautifulSoup para fornecedor.")
            html_content = self.fetch_page(supplier_url)
            if html_content:
                soup = self.get_soup(html_content)
                items = soup.select(".product-card") or soup.select(".item-box")
                for idx, item in enumerate(items):
                    title_el = item.select_one(".product-title") or item.select_one("h3")
                    price_el = item.select_one(".product-price") or item.select_one(".price")
                    
                    if not title_el or not price_el:
                        continue

                    title = title_el.text.strip()
                    if not is_fitness_product({"title": title}):
                        continue

                    products.append({
                        "supplier_item_id": f"sup_item_{idx}",
                        "title": title,
                        "price_raw": price_el.text.strip(),
                        "url": supplier_url
                    })
        except Exception as e:
            logging.error(f"Erro no scrape via Playwright/BS4 em {supplier_url}: {e}")
            
        return products
