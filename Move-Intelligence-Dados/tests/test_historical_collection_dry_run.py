"""Regressão do --dry-run do historical-collection (T0.4).

Com dry_run=True, o pipeline não pode abrir sessão nenhuma (nem get_session)
nem gravar product_clusters / product_cluster_items. Por isso, mesmo com uma
database_url inválida, a execução deve terminar com sucesso devolvendo só as
contagens previstas.
"""

from app.pipelines.run_historical_collection import CANONICAL_CATALOG, run


def test_dry_run_nao_toca_no_banco_mesmo_com_url_invalida():
    result = run(
        weeks=4,
        database_url="postgresql://usuario_invalido:senha@localhost:1/banco_inexistente",
        dry_run=True,
    )

    assert result["status"] == "success"
    assert result["dry_run"] is True
    assert result["weeks_generated"] == 4
    assert result["canonical_products"] == len(CANONICAL_CATALOG)

    expected_products = sum(len(item["sources"]) for item in CANONICAL_CATALOG) * 4
    expected_demand = sum(len(item["keywords"]) * 2 for item in CANONICAL_CATALOG) * 4
    assert result["total_products_upserted"] == expected_products
    assert result["total_snapshots_upserted"] == expected_products
    assert result["total_demand_signals_upserted"] == expected_demand
