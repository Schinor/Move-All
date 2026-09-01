import argparse
import sys
import logging
from dotenv import load_dotenv

# Carrega as variaveis de ambiente do arquivo .env se houver
load_dotenv()

# Configura o logger padrao para exibir no console
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

from app.pipelines import (
    run_api_collection,
    run_scraping_collection,
    run_etl,
    run_metrics,
    run_scores,
    run_intelligence_etl,
    run_live_intelligence,
    run_weekly_intelligence,
    run_historical_collection,
)

def main():
    parser = argparse.ArgumentParser(
        description="Sistema de Coleta e Análise Move Intelligence - Pipelines de Dados"
    )
    
    parser.add_argument(
        "--pipeline", "-p",
        choices=[
            "api",
            "scraping",
            "etl",
            "metrics",
            "scores",
            "all",
            "intelligence-etl",
            "live-intelligence",
            "weekly-intelligence",
            "historical-collection",
        ],
        required=True,
        help="A pipeline de dados que deseja executar."
    )

    parser.add_argument(
        "--period-years",
        type=int,
        default=2,
        help="Período em anos para a coleta histórica multianual (padrão: 2 anos).",
    )
    parser.add_argument(
        "--period-weeks",
        type=int,
        help="Período explícito em semanas para coleta histórica (ex.: 104 semanas).",
    )

    parser.add_argument(
        "--input",
        dest="input_path",
        help="JSON de produtos para o ETL v2 (seed Bright Data).",
    )
    parser.add_argument(
        "--demand-input",
        dest="demand_input_path",
        help="JSON opcional de sinais de demanda brutos.",
    )
    parser.add_argument(
        "--keyword-map",
        dest="keyword_map_path",
        help="Mapa YAML cluster -> keywords; usa config/keyword_map.yaml por padrão.",
    )
    parser.add_argument(
        "--database-url",
        dest="database_url",
        help="URL do PostgreSQL (ou SQLite explícito para testes).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Normaliza e valida sem escrever no banco.",
    )
    parser.add_argument("--term", help="Termo de produto para coleta em tempo real.")
    parser.add_argument(
        "--sources",
        help="Fontes separadas por vírgula (padrão: Amazon BR, Mercado Livre e Shopee BR).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Máximo de produtos por fonte (pontual: 2; semanal: 10).",
    )
    parser.add_argument(
        "--geos",
        default="BR",
        help="Regiões de demanda separadas por vírgula.",
    )
    parser.add_argument(
        "--skip-demand",
        action="store_true",
        help="Coleta somente marketplaces, sem Google Trends/TikTok Search.",
    )
    parser.add_argument(
        "--window-days",
        type=int,
        default=7,
        help="Janela temporal real da coleta de demanda (1-30 dias; padrão: 7).",
    )
    parser.add_argument(
        "--clusters",
        help="Clusters específicos separados por vírgula; vazio percorre o catálogo inteiro.",
    )
    parser.add_argument(
        "--keyword-depth",
        choices=["canonical", "all"],
        default="all",
        help="Na coleta semanal, usa só o termo canônico ou todos os subgrupos.",
    )
    parser.add_argument(
        "--max-terms",
        type=int,
        help="Limita termos da coleta semanal para smoke test ou retomada controlada.",
    )
    
    args = parser.parse_args()
    pipeline = args.pipeline
    
    logging.info(f"Executando o comando CLI com a pipeline selecionada: {pipeline}")
    
    try:
        if pipeline == "api":
            run_api_collection.run()
        elif pipeline == "scraping":
            run_scraping_collection.run()
        elif pipeline == "etl":
            run_etl.run()
        elif pipeline == "metrics":
            run_metrics.run()
        elif pipeline == "scores":
            run_scores.run()
        elif pipeline == "all":
            logging.info("Iniciando execução completa de ponta a ponta...")
            logging.info("Passo 1: Coleta via APIs...")
            run_api_collection.run()
            logging.info("Passo 2: Coleta via Scrapers...")
            run_scraping_collection.run()
            logging.info("Passo 3: Transformação e normalização ETL...")
            run_etl.run()
            logging.info("Passo 4: Consolidação de Métricas...")
            run_metrics.run()
            logging.info("Passo 5: Análise de Pontuação e Monte Carlo...")
            run_scores.run()
            logging.info("Orquestração de todas as pipelines concluída com sucesso.")
        elif pipeline == "intelligence-etl":
            run_intelligence_etl.run(
                input_path=args.input_path or run_intelligence_etl.DEFAULT_PRODUCTS_INPUT,
                demand_input_path=args.demand_input_path,
                keyword_map_path=args.keyword_map_path,
                database_url=args.database_url,
                dry_run=args.dry_run,
            )
        elif pipeline == "live-intelligence":
            if not args.term:
                parser.error("--term é obrigatório para live-intelligence")
            result = run_live_intelligence.run(
                term=args.term,
                sources=(args.sources.split(",") if args.sources else run_live_intelligence.DEFAULT_SOURCES),
                limit=args.limit or 2,
                geos=args.geos.split(","),
                include_demand=not args.skip_demand,
                database_url=args.database_url,
                keyword_map_path=args.keyword_map_path,
                dry_run=args.dry_run,
                window_days=args.window_days,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "weekly-intelligence":
            result = run_weekly_intelligence.run(
                sources=(args.sources.split(",") if args.sources else run_live_intelligence.SUPPORTED_SOURCES),
                limit=args.limit or run_weekly_intelligence.DEFAULT_LIMIT,
                geos=args.geos.split(","),
                include_demand=not args.skip_demand,
                database_url=args.database_url,
                keyword_map_path=args.keyword_map_path,
                clusters=args.clusters.split(",") if args.clusters else None,
                keyword_depth=args.keyword_depth,
                window_days=args.window_days,
                max_terms=args.max_terms,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "historical-collection":
            result = run_historical_collection.run(
                period_years=args.period_years,
                weeks=args.period_weeks,
                database_url=args.database_url,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
            
    except Exception as e:
        logging.critical(f"Erro fatal durante a execução da pipeline '{pipeline}': {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
