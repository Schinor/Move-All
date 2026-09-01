# Operação em produção

## Preparação

1. Copie `.env.production.example` para `.env.production` fora do controle de versão.
2. Defina senhas fortes, `JWT_SECRET`, `BRIGHTDATA_MCP_URL`, `NVIDIA_API_KEY` e o domínio real em `CORS_ORIGINS`.
3. Rotacione qualquer chave que já tenha sido gravada em arquivo ou log.
4. Valide a configuração com:

   ```sh
   ENV_FILE=.env.production docker compose -f docker-compose.production.yml config
   ```

5. Suba os serviços com `docker compose -f docker-compose.production.yml up -d --build`.

O backend executa `prisma migrate deploy` antes de iniciar. PostgreSQL e Redis não
publicam portas no host no compose de produção; somente o nginx do frontend fica
exposto.

## Verificações após a implantação

- `GET /api/health` deve responder `200` com PostgreSQL e Redis saudáveis.
- Uma rota protegida sem token deve responder `401`.
- Login, refresh e logout devem funcionar com rotação do refresh token.
- Execute uma coleta limitada de 20 termos antes da coleta semanal completa.
- Rode `scripts/explain-production-queries.sql` no banco e revise regressões de plano.

## Backup diário

Instale `pg_dump` no host, defina as variáveis de conexão em um arquivo legível
somente pelo usuário de operação e agende o script. Exemplo de crontab às 02:15:

```cron
15 2 * * * . /etc/move-intelligence/backup.env && /opt/move-intelligence/Move-Intelligence-Back/scripts/backup-postgres.sh >> /var/log/move-intelligence-backup.log 2>&1
```

O script mantém 14 dias por padrão (`BACKUP_RETENTION_DAYS`) e gera dumps no
formato custom. Teste a restauração em outro banco periodicamente; um arquivo de
backup sem restauração validada não é garantia de recuperação.

## Coleta semanal

O scheduler do Nest usa `WEEKLY_COLLECTION_CRON` e recusa iniciar se já houver um
job `QUEUED` ou `RUNNING`. Para manutenção, defina
`WEEKLY_COLLECTION_CRON_ENABLED=false`, reinicie o backend e aguarde o job ativo
terminar antes de migrar o banco.

## Observabilidade mínima

Monitore status e duração dos registros em `collection_jobs`, crescimento dos
volumes, uso de conexões do PostgreSQL, espaço dos volumes e respostas `429/5xx`
dos provedores. Alertas de healthcheck devem exigir falhas consecutivas para
evitar ruído durante reinícios planejados.
