# Checklist de coleta real em produção

Use este checklist durante uma janela acompanhada. As flags de coleta ficam desligadas até a ativação deliberada. Configure os segredos no gerenciador de ambiente da implantação; não registre os valores neste arquivo, em logs ou em comandos compartilhados.

## 1. Variáveis obrigatórias

- Configure `BRIGHTDATA_MCP_URL` **ou** as credenciais da API Bright Data conforme o provider selecionado. Não publique a coleta antes de validar a conexão e o orçamento.
- Configure `OPENROUTER_API_KEY` no ambiente do backend. O modelo das fichas vem de `FICHA_MODEL` ou `OPENROUTER_MODEL`.
- Revise os cron e limites antes de ligar qualquer rotina:
  - Coleta semanal: `WEEKLY_COLLECTION_CRON=0 3 * * 1` e `WEEKLY_COLLECTION_CRON_ENABLED=false`.
  - Acompanhamento: `TRACK_LISTINGS_CRON=0 2 * * *`, `TRACK_LISTINGS_CRON_ENABLED=false`, `TRACK_LISTINGS_MAX_CALLS=50`.
  - Fichas: `FICHA_ENABLED=false`, `FICHA_CRON=*/30 * * * *`, `FICHA_DAILY_CALL_LIMIT=35`.
  - Radar: `SEARCH_TRENDS_CRON=0 20 * * 0`, `SEARCH_TRENDS_CRON_ENABLED=false`, `RADAR_DISCOVERY_ENABLED=false`, `RADAR_DISCOVERY_MAX_TERMS=5`, `RADAR_DISCOVERY_LIMIT_PER_SOURCE=10`, `DISCOVERY_TERMS_CRON=0 6 * * *` e `DISCOVERY_MAX_CALLS=300` no ambiente do ETL.
  - Pré-cálculo: `CARD_ROLLUPS_CRON=*/30 * * * *` e `CARD_ROLLUPS_MAX_AGE_SECONDS=3600`.
  - Câmbio: `EXCHANGE_RATES_CRON_ENABLED=false` (o cron existente é `EXCHANGE_RATES_CRON=30 1 * * *`).
- Confirme que `collector-scheduler` não está ativo pelo perfil Python `python-scheduler`; o agendamento semanal é feito pelo Nest.

## 2. Ordem de ativação e conferência

Ative uma rotina por vez, reinicie o backend após mudar cada flag e observe a consulta indicada antes de avançar. As consultas são somente leitura e devem ser executadas no banco da implantação.

1. **Fichas:** configure o destino OpenRouter e depois ligue `FICHA_ENABLED=true`. Acompanhe a fila e o volume diário de chamadas:

   ```sql
   select status, count(*)
   from listing_fichas
   group by status
   order by status;

   select model, status, count(*)
   from ai_call_logs
   where created_at >= now() - interval '1 day'
   group by model, status
   order by model, status;
   ```

2. **Acompanhamento:** ligue `TRACK_LISTINGS_CRON_ENABLED=true`. Confirme as execuções recentes e confira anúncios marcados como encerrados:

   ```sql
   select status, count(*)
   from collection_jobs
   where category = 'track_listings'
     and created_at > now() - interval '1 day'
   group by status;

   select count(*)
   from tracked_listings
   where status = 'DEAD'
     and last_seen_at > now() - interval '3 days';
   ```

3. **Coleta semanal:** ligue `WEEKLY_COLLECTION_CRON_ENABLED=true` após confirmar o orçamento Bright Data. Verifique o estado dos jobs da última semana:

   ```sql
   select status, count(*)
   from collection_jobs
   where category = 'bright_data_etl_v2_weekly'
     and created_at > now() - interval '7 days'
   group by status;
   ```

4. **Radar de tendências:** ligue `SEARCH_TRENDS_CRON_ENABLED=true` para o cron de domingo às 20:00. Confirme as últimas coletas por estado:

   ```sql
   select status, count(*), max(captured_at) as ultima_coleta
   from search_trend_snapshots
   where captured_at > now() - interval '8 days'
   group by status;
   ```

5. **Descoberta de anúncios pelo radar:** com `FICHA_ENABLED=true` e o orçamento validado, ligue `RADAR_DISCOVERY_ENABLED=true`. Confira os jobs e os termos descobertos/aprovados:

   ```sql
   select status, count(*)
   from collection_jobs
   where category = 'radar_discovery'
     and created_at > now() - interval '7 days'
   group by status;

   select status, count(*), max(searched_at) as ultima_busca
   from discovery_terms
   group by status;
   ```

O pré-cálculo `CARD_ROLLUPS_CRON` pode permanecer ativo: ele lê dados existentes e atualiza apenas as tabelas de rollup. Confirme que foi atualizado:

```sql
select include_synthetic, computed_at, stale
from card_rollup_state
order by include_synthetic;
```

## 3. Calendário semanal

Todos os horários abaixo usam `America/Sao_Paulo` nos crons do Nest:

| Rotina | Cron | Observação |
|---|---|---|
| Radar Google Trends | domingo, 20:00 — `SEARCH_TRENDS_CRON=0 20 * * 0` | Executa apenas com `SEARCH_TRENDS_CRON_ENABLED=true`; ao terminar bem, atualiza a lista de termos. |
| Atualização diária de termos | todos os dias, 06:00 — `DISCOVERY_TERMS_CRON=0 6 * * *` | Banco local; também ocorre após o radar. |
| Coleta semanal | segunda-feira, 03:00 — `WEEKLY_COLLECTION_CRON=0 3 * * 1` | Usa termos aprovados. |
| Acompanhamento | todos os dias, 02:00 — `TRACK_LISTINGS_CRON=0 2 * * *` | Limitado por `TRACK_LISTINGS_MAX_CALLS`. |
| Fichas | a cada 30 minutos — `FICHA_CRON=*/30 * * * *` | Limitado por `FICHA_DAILY_CALL_LIMIT`. |
| Pré-cálculo dos cards | a cada 30 minutos — `CARD_ROLLUPS_CRON=*/30 * * * *` | Recalcula rollups desatualizados ou com mais de 45 minutos. |
| Câmbio | diariamente, 01:30 — `EXCHANGE_RATES_CRON=30 1 * * *` | Só com `EXCHANGE_RATES_CRON_ENABLED=true`. |

## 4. Custos estimados por semana

- Bright Data: aproximadamente **1.000 requisições/semana** — radar 188, coleta semanal até 300, descoberta cerca de 150 e acompanhamento cerca de 360. Os limites configurados não substituem o monitoramento do consumo real.
- LLM: fichas usam no máximo **35 chamadas/dia** com `FICHA_DAILY_CALL_LIMIT=35`. O modelo gratuito tem limite informado de 50 chamadas diárias para a conta inteira; outras funções compartilham o restante.

## 5. Como desligar

Defina a flag da rotina correspondente como `false` e reinicie o backend. Para interromper toda a coleta agendada, desligue `FICHA_ENABLED`, `TRACK_LISTINGS_CRON_ENABLED`, `WEEKLY_COLLECTION_CRON_ENABLED`, `SEARCH_TRENDS_CRON_ENABLED`, `RADAR_DISCOVERY_ENABLED` e `EXCHANGE_RATES_CRON_ENABLED`. O pré-cálculo pode continuar ligado.

## 6. Avisos operacionais

- Não ative o perfil Python `python-scheduler`; a coleta semanal já é agendada pelo Nest.
- Não publique nem habilite as rotinas que dependem de coleta sem configurar e validar a Bright Data. Sem configuração, o acompanhamento protegido termina como `not_configured` e não coleta anúncios.
- `RADAR_DISCOVERY_ENABLED` depende também de `FICHA_ENABLED=true`; revise limites, fila de fichas e chamadas LLM antes de ativá-lo.
- Mantenha os segredos fora deste checklist e de consultas, logs ou arquivos versionados.
