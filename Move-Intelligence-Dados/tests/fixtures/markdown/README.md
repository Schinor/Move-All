# Fixtures reais de markdown por fonte (F1.2, A1, A2)

Cada fixture são dois arquivos: `<nome>.md` (markdown de **1 página real**
capturada via Bright Data em 14/09/2026, ~38 reqs) + `<nome>.json` com todos
os campos esperados de `ParsedListing` (verificados à mão contra a página).

**Cobertura A1:** amazon_br, amazon, mercado_livre (catálogo + anúncio),
shopee_br e alibaba. **Gaps (unlocker bloqueou/vazio):** aliexpress, 1688,
tiktok_shop e as 2 páginas de avaliações — os parsers dessas fontes seguem
conservadores (só JSON-LD + título) e o harness
`tests/test_parser_fixtures.py` as pula com o motivo explícito.

**Respostas registradas (A1):** sem JSON-LD em nenhuma página capturada;
preço em blocos ("R$ 559,55" perto de "Em estoque", nunca a parcela "12x"
nem o "Preço sem oferta" riscado); "vendidos" só no ML ("+500/+25
vendidos"); distribuição de estrelas só na Amazon (barras %); vendedor em
"Vendido por/Sold by" (Amazon/ML) e link da loja (Alibaba); B2B com MOQ,
faixas por quantidade e anos do fornecedor (Alibaba). Mojibake UTF-8 em
todas (o `fix_mojibake` normaliza). Nomes de avaliadores redigidos.
