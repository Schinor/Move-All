import time
import random
import requests
import logging
from abc import ABC, abstractmethod
from typing import Dict, Optional
from bs4 import BeautifulSoup

from app.connectors.circuit_breaker import get_circuit_breaker, is_block_or_captcha

class BaseScraper(ABC):
    def __init__(self, delay_seconds: float = 2.0, timeout: int = 15, name: str = "base_scraper"):
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self.name = name
        self.breaker = get_circuit_breaker(name)
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
        ]

    def _get_headers(self) -> Dict[str, str]:
        return {
            "User-Agent": random.choice(self.user_agents),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": "https://www.google.com/",
        }

    def fetch_page(self, url: str, max_retries: int = 3) -> Optional[str]:
        """
        Realiza a requisição HTTP GET com Circuit Breaker, detecção anti-bot e retry.
        """
        if not self.breaker.can_execute():
            logging.warning(f"[{self.name}] Circuito ABERTO. Requisição para {url} abortada preventivamente.")
            return None

        for attempt in range(1, max_retries + 1):
            time.sleep(self.delay_seconds + random.uniform(0.5, 1.5))
            headers = self._get_headers()
            logging.info(f"[{self.name}] Scraping URL (tentativa {attempt}/{max_retries}): {url}")

            try:
                response = requests.get(url, headers=headers, timeout=self.timeout)
                response.raise_for_status()

                # Verifica se a página retornou um desafio / captcha mascarado em HTTP 200
                if is_block_or_captcha(response.text[:2000]):
                    raise requests.RequestException("Desafio Captcha / Cloudflare detectado no corpo da resposta")

                self.breaker.record_success()
                return response.text
            except requests.RequestException as e:
                logging.error(f"[{self.name}] Erro na tentativa {attempt} ao requisitar {url}: {str(e)}")
                if attempt < max_retries:
                    delay = 2.0 * (2 ** (attempt - 1)) + random.uniform(0.5, 1.5)
                    time.sleep(delay)
                else:
                    self.breaker.record_failure(e)
                    return None
        return None

    def get_soup(self, html_content: str) -> BeautifulSoup:
        return BeautifulSoup(html_content, "html.parser")

    @abstractmethod
    def scrape(self, target: str) -> list:
        """
        Metodo abstrato a ser implementado pelos scrapers especialistas.
        """
        pass
