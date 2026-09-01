import os
import requests
import yaml
import logging
from typing import Dict

class ExchangeRateAPI:
    def __init__(self):
        self.base_url = "https://v6.exchangerate-api.com/v6"
        self.timeout = 8
        self._load_config()
        self.api_key = os.environ.get("EXCHANGE_RATE_API_KEY")

    def _load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), '../../../configs/sources.yml')
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = yaml.safe_load(f)
                    er_config = config.get('apis', {}).get('exchange_rate', {})
                    self.base_url = er_config.get('base_url', self.base_url)
                    self.timeout = er_config.get('timeout', self.timeout)
            except Exception as e:
                logging.error(f"Erro ao carregar fontes configuradas para Exchange Rate: {e}")

    def get_latest_rates(self, base_currency: str = "USD") -> Dict[str, float]:
        """
        Obtem as taxas de cambio mais recentes.
        Caso nao exista chave de API, retorna um fallback seguro para evitar que o ETL quebre.
        """
        fallback_rates = {
            "USD": 1.0,
            "BRL": 5.45,
            "EUR": 0.92,
            "ARS": 900.0,
            "CNY": 7.25
        }
        
        if not self.api_key:
            logging.warning("Chave EXCHANGE_RATE_API_KEY nao encontrada no ambiente. Utilizando taxas fallback.")
            # Normalizar retornos com relacao a base_currency solicitada
            if base_currency in fallback_rates:
                base_val = fallback_rates[base_currency]
                return {k: v / base_val for k, v in fallback_rates.items()}
            return fallback_rates

        url = f"{self.base_url}/{self.api_key}/latest/{base_currency}"
        try:
            logging.info(f"Buscando taxas de cambio na API para moeda base: {base_currency}")
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            if data.get("result") == "success":
                return data.get("conversion_rates", fallback_rates)
            return fallback_rates
        except requests.RequestException as e:
            logging.error(f"Erro ao consultar API de taxas de cambio: {str(e)}. Usando fallback.")
            return fallback_rates
