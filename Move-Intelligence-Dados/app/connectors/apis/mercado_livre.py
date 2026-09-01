import os
import requests
import yaml
import logging

class MercadoLivreAPI:
    def __init__(self):
        self.base_url = "https://api.mercadolibre.com"
        self.timeout = 10
        self._load_config()
        # Credenciais carregadas das variaveis de ambiente
        self.client_id = os.environ.get("MLA_CLIENT_ID")
        self.client_secret = os.environ.get("MLA_CLIENT_SECRET")

    def _load_config(self):
        config_path = os.path.join(os.path.dirname(__file__), '../../../configs/sources.yml')
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = yaml.safe_load(f)
                    ml_config = config.get('apis', {}).get('mercado_livre', {})
                    self.base_url = ml_config.get('base_url', self.base_url)
                    self.timeout = ml_config.get('timeout', self.timeout)
            except Exception as e:
                logging.error(f"Erro ao carregar fontes configuradas para Mercado Livre: {e}")

    def search_items(self, query: str, limit: int = 20) -> dict:
        """
        Pesquisa itens no Mercado Livre por termo de busca.
        """
        # Limpa entrada para evitar requisicoes bizarras
        clean_query = query.strip()
        url = f"{self.base_url}/sites/MLB/search"
        params = {"q": clean_query, "limit": limit}
        
        headers = {}
        # TODO(security): Se client_id e client_secret estiverem definidos, autenticar antes da chamada.
        # Caso nao estejam definidos, faremos uma chamada publica.
        if self.client_id and self.client_secret:
            # Exemplo de cabecalho com token (stub)
            headers["Authorization"] = f"Bearer {os.environ.get('MLA_ACCESS_TOKEN', '')}"

        logging.info(f"Buscando itens no Mercado Livre com termo: {clean_query}")
        try:
            response = requests.get(url, params=params, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            # Filtro estrito: reter apenas resultados pertencentes ao segmento fitness
            from app.etl.transform.normalize_product import is_fitness_product
            if "results" in data and isinstance(data["results"], list):
                data["results"] = [
                    item for item in data["results"]
                    if is_fitness_product({"title": item.get("title", "")})
                ]
            return data
        except requests.RequestException as e:
            # Garante que logs nao vazem tokens ou segredos nos headers/URL
            logging.error(f"Erro na requisicao ao Mercado Livre para busca '{clean_query}': {str(e)}")
            return {"results": []}

    def get_item_details(self, item_id: str) -> dict:
        """
        Obtem detalhes de um item especifico pelo ID.
        """
        clean_id = item_id.strip()
        url = f"{self.base_url}/items/{clean_id}"
        
        try:
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            logging.error(f"Erro ao obter detalhes do item {clean_id}: {str(e)}")
            return {}
