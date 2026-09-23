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
    run_intelligence_etl,
    run_live_intelligence,
    run_weekly_intelligence,
    run_historical_collection,
    run_track_listings,
    run_exchange_rates,
    run_search_trends,
)

def main():
    parser = argparse.ArgumentParser(
        description="Sistema de Coleta e Análise Move Intelligence - Pipelines de Dados"
    )
    
    parser.add_argument(
        "--pipeline", "-p",
        choices=[
            "intelligence-etl",
            "live-intelligence",
            "weekly-intelligence",
            "historical-collection",
            "track-listings",
            "exchange-rates",
            "search-trends",
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
        "--exact-term",
        action="store_true",
        help="Busca o --term literal em todas as fontes (descoberta pelos termos em alta).",
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
    parser.add_argument(
        "--max-calls",
        type=int,
        help=(
            "Teto de chamadas pagas por execução (DISCOVERY_MAX_CALLS na "
            "descoberta, TRACK_LISTINGS_MAX_CALLS no acompanhamento)."
        ),
    )
    parser.add_argument("--max-requests", type=int, help="Limita as requisições do radar de Google Trends.")
    parser.add_argument("--force", action="store_true", help="Ignora snapshots recentes no radar de Google Trends.")
    parser.add_argument(
        "--allow-synthetic",
        action="store_true",
        help=(
            "Confirmação explícita e obrigatória para 'historical-collection': "
            "essa pipeline GERA dados sintéticos de demonstração (não é coleta "
            "real) e marca tudo com is_synthetic=true. Sem esta flag, a "
            "pipeline aborta."
        ),
    )

    args = parser.parse_args()
    pipeline = args.pipeline
    
    logging.info(f"Executando o comando CLI com a pipeline selecionada: {pipeline}")
    
    try:
        if pipeline == "intelligence-etl":
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
                max_calls=args.max_calls,
                exact_term=args.exact_term,
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
                max_calls=args.max_calls,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "historical-collection":
            if not args.allow_synthetic:
                parser.error(
                    "historical-collection GERA DADOS SINTÉTICOS (não é coleta real) "
                    "e não deve rodar sem confirmação explícita. Use --allow-synthetic "
                    "para confirmar que você quer popular o banco com o catálogo de "
                    "demonstração (is_synthetic=true)."
                )
            result = run_historical_collection.run(
                period_years=args.period_years,
                weeks=args.period_weeks,
                database_url=args.database_url,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "track-listings":
            result = run_track_listings.run(
                database_url=args.database_url,
                max_calls=args.max_calls,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "exchange-rates":
            result = run_exchange_rates.run(
                database_url=args.database_url,
                dry_run=args.dry_run,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False))
        elif pipeline == "search-trends":
            result = run_search_trends.run(
                database_url=args.database_url,
                dry_run=args.dry_run,
                max_requests=args.max_requests,
                force=args.force,
            )
            print("MOVE_ETL_RESULT=" + __import__("json").dumps(result, ensure_ascii=False, default=str))
            
    except Exception as e:
        logging.critical(f"Erro fatal durante a execução da pipeline '{pipeline}': {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
