# Plano de Correções — Interface e IA pós-validação (15/09/2026)

> **Para o agente que vai executar.** Leia este arquivo inteiro antes de tocar em código.
> **Origem:**
> - varredura visual completa da plataforma depois da execução de `planos_executados/PLANO_AJUSTES_VALIDACAO.md` (Fases A–D);
> - prints e pedidos do Raul durante a varredura (itens marcados com **[Raul]**).
>
> **Contexto obrigatório:** `planos_executados/PLANO_AJUSTES_VALIDACAO.md`, seções 1 (decisões) e D (interface).
> **Execução:** **uma tarefa por vez**, na ordem P0 → P1 → P2, com verificação visual (seção 0.2) ao final de cada tarefa.

---

## 0. Regras obrigatórias

1. **Não faça commit, não troque de branch, não rode `git stash`, `git reset`, `git checkout -- <arquivo>` nem `git clean`.**
2. **Não aplique migração, `db push` nem qualquer escrita em banco.** Se precisar limpar dados (ex.: cache de IA inválido), escreva a query no registro (seção 9) para o Raul rodar.
3. **NÃO reconstrua nem reinicie o container `backend`.** O `docker-compose.yml` define `RUN_DB_PUSH_ON_BOOT: "true"`, e o `CMD` do `Move-Intelligence-Back/Dockerfile` roda `npx prisma db push` na subida. Isso aplicaria as migrações pendentes, que **quem aplica é o Raul**. Mudanças de backend ficam no código, com testes; o deploy é do Raul.
4. **O container `frontend` pode ser reconstruído** (é só nginx): `docker compose up -d --no-deps --build frontend`. O `--no-deps` é obrigatório para não tocar no backend.
5. **Login:** a sessão já está aberta no Chrome em `http://localhost:4200`. Não digite senha. Se a sessão expirar, peça ao Raul para logar.
6. **Nunca invente dado.** Ausência vira `null` na API e "—" ou rótulo explicativo na UI. Texto genérico fixo simulando análise (ex.: "Validar fornecedor com melhor score") é dado inventado e deve sair.
7. **Estilo:** use só os tokens de `src/styles.css` (`--sp-*`, `--fs-*`, `--r-*`, `--surface*`, `--text*`, `--brand*`, `--success|warning|danger|info(-bg)`). Nada de `px` soltos para espaçamento, nem cores hex em CSS de componente.
8. **Os estilos são encapsulados por componente** (Angular emulated). Classe usada num componente filho (ex.: `.eyebrow`, `.panel-heading`) **não herda** o CSS do pai. Toda classe nova precisa de CSS no próprio componente. Rode o auditor da seção 0.1 antes de fechar cada tarefa.
9. **Não reabra decisões** da seção 1 do plano anterior, exceto onde este plano diz explicitamente **[Raul]**.

### 0.1 Verificação técnica (use exatamente estes comandos)

```bash
# Backend
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Back
npx prisma generate && npx tsc --noEmit -p tsconfig.json && npx jest

# Frontend (npx ng NÃO funciona neste ambiente)
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Front
./node_modules/.bin/ng build --configuration development
CI=true ./node_modules/.bin/ng test --watch=false

# Auditor de classes sem CSS (lista classes usadas em templates alterados que não existem em nenhum CSS)
python3 - <<'EOF'
import re, pathlib, subprocess
root = pathlib.Path('src')
css = ''.join(p.read_text() for p in root.rglob('*.css'))
for p in root.rglob('*.ts'):
    for m in re.finditer(r'styles:\s*\[\s*`(.*?)`', p.read_text(), re.S): css += m.group(1)
defined = set(re.findall(r'\.([A-Za-z_][\w-]*)', css))
files = []
for line in subprocess.run(['git','status','--short','--','src'],capture_output=True,text=True).stdout.splitlines():
    pp = pathlib.Path(line[3:].strip().replace('Move-Intelligence-Front/',''))
    if pp.is_dir(): files += [f for f in pp.rglob('*') if f.suffix in ('.html','.ts')]
    elif pp.suffix in ('.html','.ts') and pp.exists(): files.append(pp)
for f in sorted(set(files)):
    t = f.read_text()
    if f.suffix == '.ts':
        m = re.search(r'template:\s*`(.*?)`', t, re.S)
        if not m: continue
        t = m.group(1)
    used = set()
    for m in re.finditer(r'\sclass="([^"]+)"', t): used |= set(m.group(1).split())
    for m in re.finditer(r'\[class\.([\w-]+)\]', t): used.add(m.group(1))
    missing = sorted(c for c in used if c not in defined and '{' not in c)
    if missing: print(f, '->', ' '.join(missing))
EOF
```

**Linha de base (15/09/2026, depois das correções da seção 1):**

| Suíte | Resultado |
|---|---|
| Backend | `tsc` limpo · `jest src/modules/dashboard-api` 20/20 |
| Frontend | build OK, sem warnings · `ng test` 4 arquivos / 16 testes |
| Auditor | restam só classes pré-existentes: `ai-recommendation-card` (12), `top-bar` (3), `competitor-matrix` (1), `seasonality-forecast` (1), `trend-card` (1), `ranking` `table-view` (usada só como seletor) |

### 0.2 Verificação visual (obrigatória ao final de cada tarefa)

1. Reconstrua o frontend: `docker compose up -d --no-deps --build frontend` (a partir de `/Users/raul/Desktop/Move-All`).
2. Abra no Chrome (sessão já logada) e **tire print** de cada tela afetada pela tarefa:
   - **tema escuro e claro** (botão de tema na top-bar; ele alterna escuro → sistema → claro, confira o rótulo `Tema: …`);
   - **desktop (≥ 1440px) e celular (~400px)**. Use o modo de dispositivo do DevTools; `resize_window` não reduziu a viewport nesta máquina.
3. Para páginas de detalhe, teste **carregamento direto (F5 na URL)** e **navegação interna** (clique vindo do Ranking). O bug P0-1 só aparece no carregamento direto.
4. Registre na seção 9 o que foi visto (tela, tema, largura, OK/problema).

**URLs de teste:**
- Executivo `http://localhost:4200/`
- Ranking `http://localhost:4200/ranking`
- Dossiê `http://localhost:4200/tendencia/70085dec-2a96-4823-8bd3-454fef7c25d0` (Argolas Olímpicas; abas Adoção, Unit Economics, Concorrência, Sazonalidade, Sourcing, Simulação, Decisão)
- Comparador `/comparador` · Sourcing `/sourcing` · Sinais `/sinais` · AI Copilot `/ai-copilot` · busca global `Ctrl/Cmd+K`

---

## 1. Estado atual: já corrigido nesta sessão (não refazer)

| Área | O que estava quebrado | O que foi feito | Arquivos |
|---|---|---|---|
| Ranking (API) | `/trends/products?page=…` retornava **500** (`TypeError: res.setHeader is not a function`). O Nest roda com **Fastify**, que não tem `setHeader`. | Trocado por `res.header('X-Total-Count', …)`. **Só no código; o container backend ainda roda a versão com bug** (regra 3). | `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.controller.ts` |
| Executivo | Classes novas da D1 sem CSS: contagens em lista com bullet, cartões de ação sobrepostos e vazando para a direita, abas como botões cinza nativos, data em `Date.toString()` em inglês, rodapé só com um ícone. | CSS completo (cabeçalho com chips por ação, cartões em grid 4/2/1, abas segmentadas, top 5 em linhas), data `dd/mm/aaaa, hh:mm`, rodapé em texto, cores por ação via `data-action`, faixa em português. | `features/dashboard/dashboard.component.{html,ts,css}` |
| Bloco Recomendação | Sem estilo de título; estado vazio mostrava o enum `DECIDIR_AGORA`. | Estilizado (borda de marca, título, recomendado + alternativas); texto "classificado como “Decidir agora”". | `shared/components/intel/executive-recommendation/executive-recommendation.component.ts` |
| Matriz de bolhas | Título sem estilo; gráfico vazio com eixos quando nenhum produto tem score; tooltip com enum cru. | Estilo, legenda por ação, estado vazio explicativo, `plotted()` separado, tooltip com rótulo PT. | `shared/components/intel/quadrant-bubble/quadrant-bubble.component.ts` |
| Botão Voltar | Botão nativo cinza espremido na mesma linha do título. | Movido para cima do título, estilo discreto com hover/foco. **Ver P0-1: há regressão no carregamento direto.** | `shared/ui/page-header/page-header.component.{html,css}` |
| Ranking (UI) | Faixa como `green/yellow/red` cru, `.pager`/`.band`/`.confidence-label` sem CSS, tabela de 11 colunas espremida em `min-width: 760px`, preço sem moeda. | Chip de faixa em PT, paginação estilizada, `min-width: 1180px`, colunas de texto alinhadas à esquerda, preço em BRL, import `RiskBadgeComponent` não usado removido. | `features/ranking/ranking.component.{html,ts,css}` |
| Dossiê | `action-line`, `move-explain`, `review-panels`, `detected-line`, `top-supplier`, `compare-toggle` sem CSS ("—Faixa —O que fazer?" colado; explicabilidade em texto corrido); faixa crua; abas de métrica cortando "Avaliações"; checkbox com `min-height: 44px`. | Chips de ação/faixa/"? O que fazer", grid de explicabilidade, painéis de avaliação, sourcing estilizado, fonte com nome comercial, `metric-strip` auto-fit, `block-head` com quebra. | `features/tendencia/tendencia.component.{html,ts,css}` |
| Avisos | `.generic-notice` (Sazonalidade) e `.premise-sources` (Unit Economics) sem CSS. | Estilizados. | `seasonality-forecast.component.css`, `unit-economics-calculator.component.css` |
| Utilitário | Sem rótulo de faixa em PT. | `SCORE_BAND_LABEL` + `scoreBandLabel()`. | `shared/util/format.ts` |

---

## 2. Pré-requisitos de dados (não são bugs de interface)

Hoje **os 17 produtos voltam com `move_score`, `action`, `score_band` e `momentum` nulos**. Por isso o Executivo mostra 17 "Dados insuficientes", a matriz fica vazia e o dossiê mostra "Sem ação calculada".
- **Causa provável:** migrações da Fase B/C não aplicadas (`20260915140000_quadrant_momentum_risk`, `20260915150000_review_summaries`, `20260915160000_search_trgm`) e lote de score não rodado com os campos novos.
- **Quem resolve:** Raul (aplicar migrações, depois reconstruir o backend e rodar o lote).
- **O agente:** não mexe em banco. Todas as telas devem ficar **corretas nos dois cenários**: sem score (estado atual) e com score. Onde der, valide o cenário "com score" com dados de teste nos specs.

---

## P0 — Bloqueadores

### P0-1 — Dossiê: cabeçalho colapsa no carregamento direto (regressão desta sessão)

**Sintoma:** abrindo `/tendencia/<id>` direto (F5 ou URL colada), o título some e "Dossiê PDF" / "Exportar CSV" viram caixas enormes.
- **Medido:** `.export-btn` com 400×152 px; `h1.title` com altura 0 e **texto vazio**; `.back-btn` inexistente no DOM.
- **Recupera sozinho:** ao trocar de aba, o título e o "Voltar" aparecem normais.
- **Na navegação interna** (clique vindo do Ranking), o problema também apareceu uma vez.

**Fatos levantados:**
- **Não acontecia antes das correções da seção 1.** Carregamento direto com o template do agente anterior mostrava título e "Voltar".
- **O que mudou nesta sessão em `page-header`:** botão Voltar movido para dentro de `.titles`; CSS novo (`.titles { flex: 1 1 320px; min-width: min(100%, 320px) }`, `.actions { flex-wrap; justify-content }`). No `tendencia.component.html` mudaram `action-line`, `move-explain` e `detected-line`.
- **Console sem erros** no carregamento.
- **O DOM mostra o `<h1 class="title">` vazio**, com o template do `app-page-header` montado. Os bindings do pai (`riskTitle`, export buttons) aparecem aplicados, **mas os `input()` do filho (`title`, `showBack`) não refletem**. Isso sugere que a view do `PageHeaderComponent` (OnPush) não foi atualizada no primeiro ciclo, e não um problema só de CSS.
- **As caixas de 152 px** são efeito colateral: sem título, `.actions` ocupa a linha e os botões esticam.

**O que fazer:**
1. **Reproduzir e isolar:** abra o arquivo e reverta **manualmente** (sem git) só o `page-header.component.html` para o formato anterior (botão fora de `.titles`), reconstrua e teste o F5. Depois faça o mesmo só com o CSS. Registre qual das duas mudanças causa o bug.
2. **Se for o template:** confira se um `@if` antes do `<h1>` dentro do mesmo elemento está afetando a atualização (Angular 21, OnPush, `input()` signals). Alternativa segura: manter o botão Voltar **fora** de `.titles`, numa linha própria, com `.page-header` em `flex-direction: column` quando `showBack()` for verdadeiro (classe `[class.with-back]`).
3. **Se não for o page-header:** verifique o `@switch (product().status)` do `tendencia.component.html` e se algum binding novo (`bandText`, `actionTooltipText`, `sourceName`) lança erro silencioso no primeiro ciclo. Use `ng serve` com source maps e breakpoint em `PageHeaderComponent`.
4. **Botões de exportação:** mesmo com título, garanta `align-items: center` em `.header-actions` e `flex: 0 0 auto` em `.export-btn`, para que nunca estiquem.

**Aceite:**
- F5 em `/tendencia/<id>` mostra "← Voltar", título e subtítulo, com botões de 44 px de altura, em 5 recargas seguidas.
- Clique vindo do Ranking mostra o mesmo.
- Tema claro e escuro; 1440 px e 400 px.

---

### P0-2 — Parecer da IA (aba Decisão / cartão "Move AI · Parecer executivo") mostra JSON bruto **[Raul]**

**Sintoma (print do Raul):** o título da decisão aparece como **"monitorar"**. O texto mostra ```` ```json { "decision": "AVANCAR_COM_RESSALVAS", "rationale": … ```` cortado no meio. Os "Direcionadores Analíticos" são 3 frases fixas genéricas. O rótulo e o modelo aparecem colados: "PARECER EXECUTIVOinclusionai/ling-3.0-flash-fin:free".

**Causa (código):** `Move-Intelligence-Back/src/modules/products/products.service.ts`, `getAiRecommendation` (~l. 895–1031):
- **Limpeza do fence:** só remove ```` ``` ```` quando o texto **começa E termina** com a cerca (`text.startsWith('```')` + `replace(/```$/)`). Com `maxTokens: 1024` a resposta vem **truncada**, sem a cerca de fechamento, e o `JSON.parse` falha.
- **Fallback do `catch`:** grava `rationale: aiResponse.content` (a resposta crua inteira), `decision: moveScore.decision ?? 'REPROVAR'` e `action: parsed.action ?? 'monitorar'`, que é o **vocabulário legado**.
- **Cache de 24 h** (`findFirst` em `ai_recommendations`): devolve a linha ruim e **não devolve `key_drivers` nem `recommended_next_step`**, porque não há coluna para isso.
- **Front** (`shared/components/intel/ai-recommendation-card/ai-recommendation-card.component.ts`):
  - `drivers()` cai em **3 frases fixas** quando `keyDrivers` vem vazio (dado inventado, viola a regra 6);
  - `decision()` mostra `aiRec.action` cru quando não é uma das 5 ações ("monitorar");
  - o prompt ainda recebe `move_score.decision` legado no contexto.

**O que fazer (backend):**
1. **Extração robusta do JSON:** remover cercas em qualquer posição (`/```(?:json)?/gi`), recortar do primeiro `{` ao último `}` e só então `JSON.parse`. Criar função pura `extractJsonObject(text)` com testes: com cerca, sem cerca, truncado, texto antes/depois.
2. **Pedir JSON nativo:** passar `responseFormat: { type: 'json_object' }` (já suportado em `openrouter.service.ts` l. 35/112) e subir `maxTokens` para 1500. Manter o pedido de concisão no prompt (2–4 frases).
3. **Validar o resultado:**
   - `action` precisa ser uma das 5 ações;
   - **a ação exibida é sempre a das regras** (`ProductScore.action`, decisão 3 do plano anterior: regras classificam, IA explica). Se a IA divergir, ignore o campo da IA;
   - `rationale` string não vazia sem `{` inicial;
   - `key_drivers` array de strings.
4. **Falha de parse ou validação:**
   - **não** gravar a resposta crua como `rationale`;
   - usar texto determinístico de fallback a partir do Move Score, ação e causas do risco (mesmo padrão de fallback do `/recommendations/executive`, C6);
   - registrar a falha em `ai_call_logs` (`rejected_validation`);
   - **não usar o vocabulário legado** (`REPROVAR`, `monitorar`): sem score, `action = 'DADOS_INSUFICIENTES'`.
5. **Não cachear resposta inválida.** No caminho de cache:
   - **ignorar linhas inválidas** (ação fora das 5, `rationale` começando com ```` ``` ```` ou `{`) e regerar;
   - **devolver `key_drivers` e `recommended_next_step`** re-parseando `generatedText` com `extractJsonObject`.
6. **Remover `move_score.decision`** do `contextPayload` (substituir por `action`, `score_band`, `momentum`, `risk_explanation`, que já existem no contrato C1).
7. **Query para o Raul** (registrar na seção 9, não executar):
   `DELETE FROM ai_recommendations WHERE action NOT IN ('DECIDIR_AGORA','NEGOCIAR_CUSTO','TESTAR_DEMANDA','IGNORAR','DADOS_INSUFICIENTES') OR rationale LIKE '```%' OR rationale LIKE '{%';`
8. **Testes:** spec com a resposta real do print (truncada com cerca) → sai fallback determinístico, sem JSON na tela, ação das regras.

**O que fazer (frontend, `ai-recommendation-card`):**
1. **Direcionadores:** remover as 3 frases fixas de `drivers()`. Sem `keyDrivers`, esconder a seção ou mostrar "Sem direcionadores nesta análise".
2. **Decisão:** `decision()` usa `product().action` como fonte principal (regras). Valor desconhecido vira "Dados insuficientes", nunca o texto cru.
3. **Proteção extra:** se `rationale` começar com ```` ``` ```` ou `{`, não exibir; mostrar "Parecer indisponível no momento".
4. **CSS das 12 classes sem estilo** (`decision-header`, `model-badge`, `decision-content`, `ai-loading`, `rationale-text`, `drivers-section`, `drivers-list`, `next-step-box`, `next-step-label`, `next-step-text`, `warning`, `danger`):
   - cabeçalho em flex com espaço entre rótulo e badge do modelo (chip pequeno, `--text-3`);
   - `h3` com cores por ação (`positive`, `warning`, `danger`, com tokens);
   - caixa de próximo passo com fundo `--surface-2`;
   - lista de direcionadores com espaçamento.
5. **Rótulo do modelo:** mostrar só o nome curto (ex.: `ling-3.0-flash`), com o id completo no `title`.

**Aceite:**
- Aba Decisão do dossiê de teste sem nenhum JSON, sem "monitorar", sem frases fixas, com cabeçalho legível.
- `jest` com os novos casos passando.

---

### P0-3 — AI Copilot responde com `<tool_call>` em texto e às vezes trava **[Raul]**

**Sintoma (prints do Raul):**
- a resposta mostra `<tool_call>exec <argkey>query</argkey> <argvalue>SELECT column_name … FROM information_schema.columns …</arg_value> </tool_call>` como texto;
- o markdown come os `_` e vira itálico;
- em outras vezes a IA "faz o tool call e não responde nada, e trava sempre".

**Causa (código):**
- **Modelo:** `openrouter.service.ts` l. 64 usa por padrão `inclusionai/ling-3.0-flash-fin:free` (e `OPENROUTER_MODEL` no `.env`). Esse modelo **não usa o campo `tool_calls` nativo**: escreve uma pseudo-chamada em XML dentro de `content`.
- **Sem execução:** em `copilot.service.ts` (~l. 392–424), sem `response.toolCalls` o texto é tratado como **resposta final**, salvo em `ai_messages` e exibido. Nenhuma ferramenta roda.
- **Ferramenta inventada:** `exec` com SQL livre **não existe** em `COPILOT_TOOLS` e **nunca pode ser executada** (risco de SQL arbitrário).
- **Travamento:** o front usa `chatStream` (`copilot.service.ts` ~l. 463+). Verifique se o stream termina sem evento final quando só vem pseudo-tool-call ou conteúdo vazio, deixando o front esperando para sempre.

**O que fazer (backend):**
1. **Detector puro** `extractTextToolCalls(content)` (novo arquivo no módulo copilot, com testes):
   - reconhece `<tool_call>…</tool_call>` e variantes com `<arg_key>`/`<arg_value>`;
   - devolve `{ name, args }[]` e o texto limpo.
2. **Tratamento no `chat` e no `chatStream`:**
   - **se o nome estiver em `COPILOT_TOOLS`:** executar pelo mesmo `executeTool` (com os mesmos limites) e seguir o loop como tool call nativo;
   - **se não estiver (ex.: `exec`):** não executar, registrar em `ai_call_logs` e refazer a chamada uma vez com mensagem de sistema curta: "Use apenas as ferramentas disponíveis: …; não escreva tool calls em texto";
   - **se persistir:** responder "Não consegui consultar os dados agora. Tente reformular a pergunta." Nunca salvar nem exibir o markup.
3. **Sanitização final:** antes de salvar ou enviar qualquer `finalReply`, remover blocos `<tool_call>…</tool_call>` remanescentes.
4. **Stream sempre fecha:** todo caminho do `chatStream` (sucesso, erro, iteração esgotada, conteúdo vazio) emite o evento de término; conteúdo vazio vira a mensagem de erro amigável. Timeout total configurável (ex.: 60 s) com mensagem de erro.
5. **Modelo:** registrar na seção 9 que o modelo gratuito não suporta tool calling nativo. A troca de `OPENROUTER_MODEL` para um modelo com tool calling **é decisão do Raul** (pode ter custo). Não troque sozinho.
6. **Testes de regressão:**
   - (a) resposta com o texto exato do print → não exibe markup e não executa `exec`;
   - (b) pseudo-tool-call com ferramenta válida → executa e responde;
   - (c) stream com conteúdo vazio → emite término com mensagem de erro.

**O que fazer (frontend, `features/ai-copilot`):**
1. **Nunca travar:** timeout visual. Se o stream não emitir nada em 60 s ou fechar sem conteúdo, encerrar o estado "digitando" e mostrar erro com botão "Tentar de novo".
2. **Mensagens já salvas:** em `renderCopilotMarkdown` (`shared/utils/markdown.util.ts`), remover blocos `<tool_call>…</tool_call>` antes de renderizar, porque as conversas antigas no banco já têm o markup.

**Aceite:**
- Pergunta "ola" e "qual o produto com maior Move Score?" respondem sem markup e sem travar (5 tentativas cada).
- Conversa antiga do print abre sem mostrar `<tool_call>`.

---

### P0-4 — Ranking: validar depois do deploy do backend

A correção do 500 está no código (seção 1), mas **o container ainda roda o bug**. Enquanto o Raul não fizer o deploy, `/ranking` mostra "Não foi possível carregar os dados".
1. **Teste de controller:** criar teste para `DashboardApiController.listTrendingProducts` com `res` mockado de Fastify (`{ header: jest.fn() }`), confirmando `X-Total-Count` e o corpo `{ items, total, page, page_size }`.
2. **Bugs de ordenação** a corrigir em `ranking.component.ts`:
   - `apiSort()` mapeia `rating` → `'reviews'` (errado);
   - ignora `dir`, então a API sempre ordena num sentido só;
   - `sortClient()` reordena só a página atual, contradizendo a ordenação da API;
   - **conserto:** aceitar `sort=rating` e `dir=asc|desc` no backend (`listTrendingProducts`) e remover a reordenação local quando a paginação vier da API.
3. **Depois do deploy (Raul avisa):**
   - verificação visual completa da tabela (11 colunas, chips de faixa, paginação, filtro por ação via `/ranking?action=DECIDIR_AGORA`, busca, visão Cartões);
   - voltar do dossiê preserva página, filtro e scroll.

**Aceite:** jest verde; ordenação por Nota e por Preço asc/desc correta entre páginas (teste de service).

---

### P0-5 — AI Copilot para de responder ao trocar de conversa ou de aba **[Raul]**

**Sintoma:** com uma resposta sendo gerada, se o usuário troca de conversa no histórico ou navega para outra tela, a resposta some e o Copilot "para de responder". Ao voltar, a conversa não mostra a resposta, e às vezes não aceita nova pergunta.

**Causa (código):**
- **O stream vive dentro do componente.** `features/ai-copilot/ai-copilot.component.ts#sendMessage` (~l. 94–168):
  - guarda a resposta num placeholder local (`assistantIndex`, `assistantMessage`);
  - escreve token a token em `this.messages` via callback de `copilot.chatStream` (`core/services/copilot.service.ts` ~l. 88–115, `fetch` + `reader.read()`).
- **Trocar de conversa:** `this.messages` é substituído pelas mensagens da outra conversa, mas os tokens continuam sendo gravados em `updated[assistantIndex]` **da lista errada** (sobrescreve ou insere mensagem na conversa aberta).
- **Sair da tela:** o componente é destruído e os callbacks atualizam signals de um componente morto; ao voltar, um componente novo carrega do banco **antes** de a resposta terminar.
- **Nada cancela nem reata o stream:** `isThinking` é por instância, e a guarda `if (... this.isThinking()) return` pode bloquear envio enquanto o stream antigo não fecha.
- **Backend** (`copilot.controller.ts` l. 42–78 e `copilot.service.ts#chatStream`):
  - a mensagem do assistente só é salva em `ai_messages` **depois** que o `for await` termina (`aiMessage.create` ~l. 68 do método);
  - não há tratamento de desconexão do cliente (`raw.on('close')`): conforme o ponto em que o `raw.write` falha, a geração continua sem destino ou é interrompida **sem salvar**.

**O que fazer (frontend):**
1. **Tirar o estado do stream do componente:** criar um store `providedIn: 'root'` (ex.: `core/services/copilot-stream.store.ts`) com, por `conversationId`, `status: 'idle' | 'thinking' | 'streaming' | 'error'`, `partialContent` e `startedAt`. O `fetch`/reader roda no store, não no componente.
2. **O componente só lê o store:** ao abrir uma conversa, mostra as mensagens do banco **mais** o `partialContent`, se aquela conversa tiver stream ativo. Trocar de conversa não mexe no stream da outra.
3. **Nova conversa ainda sem id:** o store guarda o stream numa chave temporária e migra para o `conversationId` recebido no primeiro evento.
4. **Voltar para a tela** com stream ainda ativo: continua mostrando os tokens. Stream já terminado: recarrega a conversa do banco (`getConversation`).
5. **Indicador no histórico:** conversa com resposta em andamento mostra um ponto "respondendo…".
6. **Uma pergunta por conversa:** a guarda de envio vale por conversa (não global); outra conversa pode receber pergunta.
7. **Cancelar explicitamente:** botão "Parar" durante a geração (`AbortController` no `fetch`). Só o botão cancela, não a navegação.
8. **Timeout de P0-3** também vale aqui: sem evento por 60 s → `status: 'error'` com "Tentar de novo".

**O que fazer (backend):**
1. **A resposta não depende da conexão:** acumular os tokens em memória durante o `for await` e **salvar a mensagem do assistente sempre**, inclusive se o cliente desconectar (`try/finally` no service; no controller, `raw.on('close')` só para de escrever, não interrompe a geração).
2. **Escrita segura:** `raw.write` protegido quando `raw.writableEnded`/`destroyed`; nunca lançar por escrever em socket fechado.
3. **Conversa sempre sabe o que foi perguntado:** a mensagem do usuário é salva **antes** de começar a gerar (conferir `prepareConversation`).
4. **Testes:**
   - (a) cliente desconecta no meio → mensagem do assistente salva com o conteúdo completo;
   - (b) erro do provedor no meio → salva o parcial com aviso, ou mensagem de erro, e fecha o stream.

**Aceite (roteiro manual, 3 vezes cada):**
1. Perguntar e, durante a geração, clicar em outra conversa: a outra conversa não recebe tokens; voltar mostra a resposta completa (ou em andamento).
2. Perguntar e ir para o Executivo: voltar ao Copilot mostra a resposta completa.
3. Perguntar em A, trocar para B e perguntar em B: as duas respondem.
4. "Parar" interrompe e a conversa volta a aceitar pergunta.

---

## P1 — Pedidos do Raul e defeitos visíveis

### P1-1 — Executivo: remover os 4 cartões e usar os chips no topo com "?" explicativo **[Raul]**

**Pedido:**
- **Eliminar** os 4 cartões ("Decidir agora", "Negociar custo", "Testar demanda", "Ignorar", com contagem, descrição e "Ver no ranking").
- **Manter só a faixa de chips** ("● Decidir agora 0 · ● Negociar custo 0 · … · Dados insuficientes 17"), **no topo da página**.
- Um **"?" pequeno ao lado de cada tipo de decisão**; ao passar o cursor, aparece a explicação daquela decisão.

Isto substitui o item "4 cartões clicáveis" da D1 do plano anterior.

**O que fazer:**
1. **`dashboard.component.html`:**
   - remover a `<section class="action-cards">` inteira;
   - mover a `<section class="exec-header">` para **logo abaixo do `app-page-header`**, antes de `<app-executive-recommendation />`.
2. **Chips:**
   - cada chip de ação (as 4 ações + "Dados insuficientes") vira um `<a>` para `/ranking?action=<AÇÃO>` (preserva a navegação que os cartões davam; o botão voltar do plano anterior depende disso);
   - dentro do chip: bolinha de cor, rótulo, contagem e o "?" (a explicação de "Dados insuficientes" já existe em `ACTION_TOOLTIP`).
3. **Tooltip de verdade** (não o `title` nativo, que demora e não funciona no toque):
   - criar `shared/ui/hint/hint.component.ts` (`app-hint`), com `input` `text` e `label`;
   - gatilho: botão circular 16–18 px com "?";
   - abre em **hover, foco e toque**; fecha com Esc, mouse fora e toque fora;
   - `role="tooltip"`, `aria-describedby`, posição acima com fallback abaixo;
   - estilo igual ao `.explain-popover` de `shared/ui/explain/explain.component.css`.
   - O `?` fica **fora** do `<a>` (ou com `event.stopPropagation()` + `preventDefault()`), para que passar o mouse ou tocar no "?" não navegue.
4. **Limpeza de CSS:** remover do `dashboard.component.css` as regras `.action-cards`, `.action-card*`, `.action-name`, `.action-desc`, `.action-go`, `.hint`. Ajustar `.exec-counts li` para chip clicável (hover com `--surface-3`, `focus-visible` com `--focus-ring`).
5. **Celular:** chips quebram em linhas; tooltip não sai da tela (`max-width: min(280px, 80vw)`).

**Aceite:**
- Topo do Executivo = título → resumo (17 produtos + chips com "?") → Recomendação → Top 5 → Matriz.
- Hover no "?" mostra o texto da ação sem navegar; clique no chip abre o Ranking filtrado.
- Teclado: Tab chega no chip e no "?".

---

### P1-2 — Gráfico de evolução (Volume / Preço / Avaliações): manter o atual + diferença entre meses **[Raul]**

**Pedido:** "o radar de volume também deveria mostrar o que já mostrava + a diferença entre outros meses".
Arquivo: `shared/components/intel/adoption-curve-chart/adoption-curve-chart.component.{ts,html,css}`, usado na aba Adoção do dossiê.

**Hoje:**
- linha semanal com Pico/Base;
- chip `+N%`, que compara o **primeiro com o último ponto** da janela;
- "N pontos";
- linha tracejada do período anterior quando "Comparar com período anterior" está marcado.

**O que fazer (sem remover nada do que existe):**
1. **Agregação mensal no front** (função pura em `shared/util/series.ts`, com teste), a partir dos `points` semanais:
   - **Volume:** soma das semanas do mês.
   - **Preço:** média do mês.
   - **Avaliações** (série acumulada): último valor do mês; diferença = avaliações novas no mês.
   - **Mês incompleto** (primeiro ou último da janela com menos semanas) marcado como "parcial". Não extrapolar.
2. **Faixa "Mês a mês"** abaixo do gráfico:
   - uma célula por mês (`jul/26`), com o valor e a variação contra o mês anterior (`▲ +12%` verde / `▼ −5%` vermelho / "—" no primeiro mês);
   - rolagem horizontal no celular.
3. **Tooltip do ponto:** além do valor, mostrar "vs semana anterior" e "vs mesmo período do mês anterior", quando existir.
4. **Rótulo do chip:** o `+N%` do cabeçalho passa a dizer o que compara ("na janela"). Acrescentar um segundo chip "último mês vs anterior".
5. **Janela `7d`** (sem mês completo): esconder a faixa mensal e mostrar "Selecione 60d ou mais para comparar meses".
6. **Painel de distribuição de estrelas:** hoje mostra três chips "—" quando não há distribuição (A5 sem coleta). Trocar por uma linha única: "Distribuição de estrelas ainda não coletada para este produto."

**Aceite:**
- Na aba Adoção, janela 6m, as três métricas mostram gráfico + chip da janela + faixa mensal com variações coerentes com os pontos (conferir 2 meses à mão e registrar).
- Nada inventado em mês sem dado.

---

### P1-3 — "Radar de sub-sinais" vazio **[Raul]**

**Sintoma:** card "Radar de sub-sinais · 6 DIMENSÕES" totalmente vazio.

**Causa:** `shared/components/intel/opportunity-radar/opportunity-radar.component.ts` filtra os sinais sem valor (correto, B6), mas quando **nenhum** sinal tem valor passa `indicator: []` ao ECharts, que desenha nada. O "6 dimensões" é **texto fixo** no HTML. No produto de teste, `signals` vem vazio da API (o hero também mostra "0 indicadores").

**O que fazer:**
1. **Contagem real:** o cabeçalho mostra `N dimensões` a partir dos sinais com valor.
2. **0 sinais:** estado vazio no lugar do gráfico: "Sub-sinais ainda não calculados para este produto", com a lista das 6 dimensões esperadas em texto cinza.
3. **1–2 sinais:** radar fica ruim. Mostrar barras horizontais (0–100) em vez de radar.
4. **Backend:** verificar por que `signals` vem vazio em `/trends/products/:id` (`dashboard-api.service.ts#getTrendProduct`). Se for só falta de coleta, registre. Se for bug de mapeamento (ex.: nomes de chave diferentes de `marketplaceGrowth`, `supplierGrowth`…), corrija com teste.

**Aceite:** o card nunca aparece vazio; com dados, radar com as dimensões certas.

---

### P1-4 — Busca global não encontra termo parcial

**Sintoma:** `Ctrl+K` → "halter" → "Nada encontrado", embora exista "Halteres Ajustáveis Selecionáveis 24kg Par". A API `GET /api/search?q=halter` responde **200 com listas vazias**.

**Causa:** `dashboard-api.service.ts#search` (~l. 1076) filtra com o operador `%` (`similarity ≥ 0,3`) comparando o termo com o **nome inteiro**. Termo curto contra nome longo dá similaridade baixa.

**O que fazer:**
1. Trocar o filtro por `word_similarity` (operador `<%`) **ou** `ILIKE '%termo%'`, combinados. Ordenar por `GREATEST(word_similarity, similarity)` e dar prioridade a quem contém o termo.
2. Manter os 3 caminhos (unaccent / sem unaccent / sem pg_trgm) e aplicar a mesma lógica nos três.
3. **Testes:** "halter" → Halteres; "esteira" → Walking Pad Esteira; "yoga" → Tapete de Yoga; "halteres" sem acento/maiúsculas.
4. **Front** (`command-palette.component.ts`): categoria hoje leva para `/ranking` sem filtro. Levar para `/ranking?q=<categoria>`, já suportado pela URL do ranking.

**Aceite:** os 4 termos acima retornam o produto na palette (depois do deploy do backend; antes, só os testes).

---

### P1-5 — Dossiê: aba Decisão e aba Simulação não verificadas

Na varredura, o clique programático nas abas "Decisão" e "Simulação" não abriu o conteúdo, então **não foram inspecionadas**. Depois de P0-2, abrir as duas, rodar o auditor e corrigir tudo o que estiver sem estilo ou com vocabulário antigo ("Avançar", "Reprovar", "Trend Score", "Opportunity Score").

---

### P1-6 — AI Copilot: trocar o subtítulo por "?" ao lado do título **[Raul]**

**Pedido:** remover o texto explicativo abaixo de "AI Copilot" ("Assistente de inteligência de mercado e sourcing fundamentado em dados reais do catálogo.") e colocar um **"?" ao lado do título** que mostra essa explicação ao passar o cursor.

**O que fazer:**
1. **`shared/ui/page-header`:** novo `input` opcional `hint` (string). Quando presente, renderiza `app-hint` (componente criado em P1-1) **ao lado do `<h1>`**, alinhado na linha de base do título. Não mudar o comportamento de quem não passa `hint`.
2. **`features/ai-copilot/ai-copilot.component.html`:** trocar `subtitle="…"` por `hint="Assistente de inteligência de mercado e sourcing fundamentado em dados reais do catálogo. Responde só com produtos que existem nos dados consultados."`.
3. **Mesmo padrão para as demais páginas:** não aplicar agora. Registre na seção 9 a sugestão para o Raul decidir (Ranking, Sourcing, Sinais têm subtítulos longos).
4. **Com a área liberada**, o botão "Nova conversa" sobe para a linha do título. Conferir que não quebra em 400 px.

**Aceite:** título "AI Copilot ?" sem subtítulo; hover, foco ou toque no "?" mostra o texto; tema claro e escuro.

---

### P1-7 — Barra lateral no padrão do vídeo de referência (recolher dentro da sidebar) + breadcrumb discreto **[Raul]**

**Pedido:**
- A seta dupla `«` que recolhe a barra lateral fica no início da top-bar, ao lado do breadcrumb, e **testadores acharam que era botão de voltar**. O controle deve ficar **dentro da sidebar**.
- O breadcrumb "INVESTIGAR / AI Copilot" tem destaque demais e **parece clicável**.
- **Referência visual:** `/Users/raul/Desktop/Gravação de Tela 2026-09-15 às 11.26.35.mov` (26 s, barra lateral do ChatGPT). Para ver sem player, extraia quadros:
  `ffmpeg -v error -i "<arquivo>" -vf "fps=1/2,scale=1200:-2" /tmp/f%02d.jpg`

**O que o vídeo mostra (comportamento a reproduzir):**

| Estado | Comportamento |
|---|---|
| **Recolhida (rail estreito)** | Coluna fina só com ícones: logo no topo; abaixo, ícones das ações principais; avatar do usuário no rodapé. **Nenhum botão de abrir fora da sidebar.** |
| **Hover no logo recolhido** | O logo **vira o ícone de painel** (abrir barra lateral) e aparece o tooltip **"Abrir barra lateral"** ao lado. Clique expande. |
| **Expandida** | Cabeçalho com a marca à esquerda e, à direita, ícone de busca + **ícone de painel** com tooltip **"Fechar barra lateral"**. Itens com ícone + rótulo; seção "Recentes" com lista em texto simples; rodapé com avatar, nome e plano. |
| **Conteúdo** | Expandir/recolher empurra o conteúdo principal (não sobrepõe) em desktop. A top-bar não tem controle da sidebar. |
| **Estilo dos itens** | Sem caixa nem borda; item ativo/hover com fundo sutil arredondado; títulos de seção ("Recentes") em cinza pequeno, **sem aparência de link**. |

**Onde está hoje:**
- `shared/layout/top-bar/top-bar.component.html` l. 2–18: `button.icon-btn.sidebar-toggle` (ícones `panel-left-close`/`panel-left`, `toggleSidebar()`) e `.breadcrumb` (`.eyebrow` + `strong`);
- estado em `core/services/layout.service.ts` (`sidebarOpen`, `toggleSidebar`);
- sidebar em `shared/layout/app-sidebar/app-sidebar.component.{html,ts,css}`: marca (`app-brand-lockup` / `app-brand-mark` em `.brand-rail`), grupos DECIDIR/INVESTIGAR/EXECUTAR com `h2.section-label`, rail de `--sidebar-rail-w: 60px`.

**O que fazer:**
1. **Top-bar (desktop):** remover o `sidebar-toggle`. Em telas compactas (sidebar vira gaveta), manter um botão **hambúrguer** (`bars`) com `aria-label="Abrir navegação"`, nunca seta.
2. **Cabeçalho da sidebar expandida:** `app-brand-lockup` à esquerda; à direita, botão com ícone `panel-left-close`, `aria-label` e tooltip **"Fechar barra lateral"** (usar `app-hint`/tooltip de P1-1 em modo rótulo, ou tooltip próprio; não `title` nativo).
3. **Rail recolhido:**
   - no topo, `app-brand-mark`; em `:hover`/`:focus-visible` troca para o ícone `panel-left` com tooltip **"Abrir barra lateral"** à direita; clique expande;
   - abaixo, só os ícones dos módulos, cada um com tooltip do rótulo à direita (hoje é `title` nativo: trocar);
   - no rodapé, avatar/conta (ver item 6).
4. **Grupos de navegação:**
   - `section-label` (DECIDIR/INVESTIGAR/EXECUTAR) em `--text-3`, `--fs-caption`, sem caixa alta pesada, e **escondidos no rail**;
   - itens com ícone + rótulo, fundo `--surface-2` no hover e ativo, `--r-md`, **sem borda lateral verde grossa nem caixa**;
   - badge "em breve" discreto (texto `--text-3`, sem borda).
5. **Transição:** largura animada (`--dur-base`, `--ease`), conteúdo empurrado. Estado persiste como hoje (`LayoutService`). Respeitar `prefers-reduced-motion`.
6. **Rodapé da sidebar:** mover o bloco de conta (avatar + nome + e-mail) da top-bar para o rodapé da sidebar, como no vídeo (clique abre o mesmo menu de conta: tema, gerenciar acesso, sair). A top-bar fica com busca, "Ask Move AI", notificações e tema. **Se isso exigir mudar muitos testes ou fluxos, faça só os itens 1–5 e registre o 6 como pendência para o Raul decidir.**
7. **Breadcrumb sem cara de link:**
   - seção em `--text-3`, `--fs-caption`, sem caixa alta e sem `letter-spacing`;
   - página em `--text-2`, peso 500;
   - sem hover, sem `cursor: pointer`.
   - Como o título já está no `page-header`, **esconda o breadcrumb em desktop** e mantenha só em telas compactas. Registre a escolha.
8. **Limpeza:** remover o `title="Expandir"` adicionado por engano no botão de conta da top-bar (ele abre um menu).
9. **Command palette:** a ação "Alternar sidebar" continua funcionando.

**Aceite:**
- Desktop: nenhum controle de sidebar na top-bar; hover no logo recolhido mostra "Abrir barra lateral"; ícone no cabeçalho expandido mostra "Fechar barra lateral"; conteúdo é empurrado; estado persiste após F5.
- 400 px: hambúrguer abre a gaveta; tocar fora fecha.
- Teclado: Tab alcança abrir/fechar e todos os itens; tooltips aparecem no foco.
- Tema claro e escuro.

---

### P1-8 — AI Copilot com visual limpo de chat (referência do vídeo) **[Raul]**

**Pedido:** adotar no AI Copilot o visual do vídeo de referência (mesmo arquivo de P1-7): chat minimalista, com foco no campo de pergunta.

**Hoje** (`features/ai-copilot/ai-copilot.component.{html,css,ts}`, ver prints do Raul):
- título + subtítulo grandes (P1-6 remove o subtítulo);
- painel "HISTÓRICO / Conversas" como card com borda à esquerda;
- mensagens em cards com borda;
- mensagem do usuário em **bloco verde neon de largura quase total**;
- campo de pergunta retangular com botão "Enviar" verde.

**Referência (quadros do vídeo):**
- **Estado vazio centralizado:** saudação curta no meio da tela; logo abaixo, **composer em pílula** (cantos totalmente arredondados, fundo `--surface-2`, sem borda forte) com "+" à esquerda, placeholder e **botão de enviar circular** à direita; abaixo, **sugestões como linhas simples** (ícone pequeno + texto), sem cards.
- **Pouco cromo:** nada de caixas em volta de tudo; hierarquia pelo espaço e pela tipografia.

**O que fazer:**
1. **Estado vazio** (conversa nova, sem mensagens):
   - coluna central `max-width: 720px`, vertical e horizontalmente centrada;
   - saudação: "Pergunte sobre produtos, scores e fornecedores" (`--fs-h2`, `--font-display`);
   - composer em pílula logo abaixo;
   - 3–4 sugestões existentes (`useSuggestion`) como linhas clicáveis (ícone + texto, hover com fundo sutil).
2. **Com mensagens:**
   - coluna central `max-width: 760px`;
   - **assistente sem card**: texto direto no fundo, com o marcador "Move AI" pequeno em `--text-3` e hora só no hover;
   - **usuário** em bolha discreta alinhada à direita (`--surface-2`, `--r-lg`, `max-width: 80%`). **Não usar verde neon de fundo.** O verde da marca fica só em detalhes (botão enviar, foco);
   - composer em pílula **fixo no rodapé** da área de chat, com fundo que cobre o conteúdo que rola por baixo;
   - botão **"Parar"** no lugar do enviar durante geração (P0-5).
3. **Histórico de conversas no padrão da sidebar do vídeo:**
   - painel sem card nem borda verde, lista em texto simples ("Recentes"), item ativo com fundo sutil;
   - ações (fixar, renomear, excluir) só no hover do item, em menu "⋯";
   - recolher/expandir com o **mesmo ícone de painel e tooltips** de P1-7 ("Fechar histórico" / "Abrir histórico"), **não com seta `«`**;
   - "Nova conversa" como item no topo do painel (ícone lápis + texto), como "Novo chat" no vídeo, em vez de botão solto no cabeçalho da página.
4. **Cabeçalho da página:** só "AI Copilot" + "?" (P1-6), compacto, sem ocupar a área do chat.
5. **Markdown:** respeitar P0-3 (sem `<tool_call>`), com código e tabelas legíveis dentro da coluna central.
6. **Celular (~400 px):** histórico vira gaveta (abre pelo ícone de painel); composer ocupa a largura com margem `--sp-4`; sugestões em lista.
7. **Tokens apenas** (regra 7) e tema claro conferido.

**Aceite:**
- Conversa nova mostra estado vazio centralizado com composer em pílula e sugestões em linhas.
- Conversa com mensagens: assistente sem card, usuário em bolha discreta à direita, composer fixo embaixo.
- Histórico sem card, ações no hover, recolher com ícone de painel.
- Prints nos 2 temas × 2 larguras.

---

## P2 — Acabamento

### P2-1 — Sinais & Alertas: vocabulário e formulário
- `features/sinais/sinais.component.html` l. 49: "Gatilho: Trend Score Mínimo" é vocabulário removido (decisão 1). Trocar pelo gatilho equivalente do modelo novo, ou pelo campo que o backend de alertas usa hoje (C8 dispara por mudança de **ação**). Se o campo não tiver mais efeito, removê-lo e dizer isso na UI.
- Formulário da "Central de alertas" desalinhado: checkbox, select, webhook e gatilhos quebram em alturas diferentes. Usar grid com rótulos em cima e colunas `repeat(auto-fit, minmax(200px, 1fr))`.

### P2-2 — Classes pré-existentes sem CSS
Verifique visualmente e estilize, ou remova a classe se não tiver função:
- `top-bar`: `account-menu`, `notification-menu`, `sidebar-toggle`;
- `competitor-matrix`: `competitors-grid`;
- `seasonality-forecast`: `status-indicator`;
- `trend-card`: `head-left`.

### P2-3 — Tema claro
Conferir todas as telas da seção 0.2 no tema claro. Pontos de atenção:
- `quadrant-bubble` usa hex fixo em `ACTION_COLOR` (`#e5e7eb` para "Dados insuficientes" some no fundo claro): trocar pelos tokens `--success`, `--warning`, `--info`, `--text-3` lidos de `readEchartsTheme()`;
- chips de faixa e ação (fundo `*-bg`) com contraste AA;
- linha tracejada do período anterior visível.

### P2-4 — Celular (~400 px)
Conferir:
- Executivo (chips quebrando, tooltip dentro da tela);
- Ranking (vira Cartões; paginação visível);
- Dossiê (header com Voltar/título/botões empilhados, `metric-strip` em 1 coluna, `move-explain` em 2, abas de métrica sem corte, faixa mensal com rolagem);
- Comparador, Sourcing e Copilot.

Nenhuma página pode ter rolagem horizontal no `body`.

### P2-5 — Trend-card (visão Cartões do Ranking)
O rótulo `Move Score · <ação> <seta>` num único `div` quebra feio com ação longa ("Dados insuficientes"). Separar em rótulo "Move Score" e chip de ação (mesmo estilo do dossiê), com faixa em PT via `scoreBandLabel`.

---

## 8. Ordem sugerida e checkpoints

1. **P0-1** (regressão visível em toda página de detalhe) → checkpoint visual.
2. **P0-2, P0-3 e P0-5** (IA e Copilot) → checkpoint: `jest` + prints da aba Decisão + roteiro manual do Copilot (P0-5).
3. **P0-4** (testes + ordenação) → aguardar deploy do Raul para a parte visual.
4. **P1-1 → P1-8** (P1-1 antes de P1-6/P1-7, que reusam o `app-hint`; P1-8 depois de P0-3, P0-5 e P1-6) → checkpoint visual completo (seção 0.2, 2 temas × 2 larguras).
5. **P2** → checkpoint final com o auditor zerado para arquivos alterados.

**Para cada checkpoint: pare e aguarde aprovação do Raul.**

---

## 9. Registro de execução

> O agente acrescenta uma entrada por tarefa: data, tarefa, arquivos alterados, saída real da verificação 0.1, prints e observações da 0.2, queries deixadas para o Raul e pendências.

### 15/09/2026 — Varredura e correções iniciais (sessão de diagnóstico)
- **Feito:** itens da seção 1.
- **Verificação:**
  - `ng build` OK sem warnings;
  - `ng test` 4/16;
  - backend `tsc` limpo, `jest src/modules/dashboard-api` 20/20;
  - frontend reconstruído com `--no-deps`.
- **Visual:** Executivo, Ranking (via API sem paginação), Dossiê (Adoção, Unit Economics, Concorrência, Sazonalidade, Sourcing), Comparador, Sourcing, Sinais, Copilot e busca, em tema escuro e desktop.
- **Não verificado:** tema claro, 400 px, abas Decisão e Simulação.
- **Pendências abertas:** P0-1 a P0-5, P1-1 a P1-8, P2-1 a P2-5.
- **Para o Raul:**
  - aplicar migrações pendentes e reconstruir o backend (ativa a correção do 500 do Ranking);
  - decidir o modelo do OpenRouter com tool calling nativo (P0-3);
  - rodar a query de limpeza de `ai_recommendations` depois de P0-2.

### 15/09/2026 — P0-1 (cabeçalho do Dossiê no carregamento direto)
- **Feito:** o cabeçalho do Dossiê usa um ramo de loading com fallback e um ramo `ready` montado com o título/subtítulo canônicos; isso evita que o `PageHeader` estável retenha os inputs iniciais no F5. O botão Voltar permanece acima do título e os botões de exportação mantêm altura compacta, alinhamento vertical e não crescem para preencher o header.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.html`, `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.css`, `Move-Intelligence-Front/src/app/shared/ui/page-header/page-header.component.{html,ts,css}` (contrato de Voltar/hint e estilos compartilhados já usados pelas telas do plano).
- **Verificação técnica final:** `docker compose --env-file .env -f docker-compose.yml build frontend` passou; no estágio Node 20, `./node_modules/.bin/ng build` passou e `CI=true ./node_modules/.bin/ng test --watch=false` passou com 6 arquivos e 28 testes. O backend não foi reiniciado nem alterado nesta correção.
- **Visual:** após login local autorizado, abertura direta do Dossiê no Chrome mostrou `Voltar`, `Argolas Olímpicas de Madeira Calistenia Crossfit`, `Functional training`, `Dossiê PDF` e `Exportar CSV`; o estado de loading exibiu `Detalhe da tendência` enquanto aguardava a API.
- **Limite da verificação 0.2:** a sessão expirou durante as recriações do frontend e foi necessário autenticar novamente. Ainda ficam pendentes, para o aceite completo, as 5 recargas diretas, o clique Ranking → Dossiê, tema claro e viewport aproximado de 400 px.
- **Queries para o Raul:** nenhuma; não houve escrita, migração ou alteração de dados.
- **Checkpoint:** correção de código do P0-1 registrada; aguardar o aceite visual do Raul antes de avançar para P0-2.

### 15/09/2026 — P0-2 (parecer da IA sem JSON bruto)
- **Feito (backend):** novo módulo puro `Move-Intelligence-Back/src/modules/products/ai-recommendation-json.ts` (`extractJsonObject`, `parseRecommendationPayload`, `isRawRationale`, `normalizeAction`, `fallbackRationale`, `QUADRANT_ACTIONS`) com spec de 7 casos (cerca, sem cerca, truncado do print → `no_json_found`, validação das 5 ações, fallback determinístico). `getAiRecommendation`: `responseFormat: json_object` + `maxTokens: 1500`; ação exibida sempre a das regras; falha → fallback determinístico (score/ação/causas) + `ai_call_logs` (`rejected_validation`) + `promptVersion` `v2.1-deterministic-fallback`; cache ignora linhas inválidas e re-parseia `generatedText` para `key_drivers`/`recommended_next_step`; `move_score.decision` removido do contexto (entra `action`, `score_band`, `momentum`, `risk_explanation`, `risk_drivers`). Spec de serviço com a resposta truncada do print → fallback sem JSON na tela + ação das regras + log; JSON válido com ação divergente mantém a das regras; cache inválido antigo regenera.
- **Feito (frontend):** `ai-recommendation-card` sem frases fixas (seção some ou "Sem direcionadores nesta análise"), `decision()` pela `action` das regras (desconhecido → "Dados insuficientes"), `rationale` cru → "Parecer indisponível no momento", `shortModel()` (ex.: `ling-3.0-flash`, id completo no `title`); CSS das 12 classes com tokens.
- **Arquivos da tarefa:** `Move-Intelligence-Back/src/modules/products/ai-recommendation-json.{ts,spec.ts}`, `Move-Intelligence-Back/src/modules/products/products.service.{ts,spec.ts}`, `Move-Intelligence-Front/src/app/shared/components/intel/ai-recommendation-card/ai-recommendation-card.component.{ts,html,css}`.
- **Verificação técnica:** `tsc` limpo; `jest src/modules/products/` 4 suítes / 28 testes; `ng build` OK; auditor restrito aos alterados sem novas classes (restam só as pré-existentes da linha de base).
- **Visual (0.2, pendente do Raul):** aba Decisão do dossiê de teste nos 2 temas × 2 larguras; sessão do executor sem login no Chrome — não foi digitada senha.
- **Queries para o Raul (não executar):**
  `DELETE FROM ai_recommendations WHERE action NOT IN ('DECIDIR_AGORA','NEGOCIAR_CUSTO','TESTAR_DEMANDA','IGNORAR','DADOS_INSUFICIENTES') OR rationale LIKE '```%' OR rationale LIKE '{%';`
- **Pendências:** verificação visual da aba Decisão; limpeza do cache inválido (query acima).

### 15/09/2026 — P0-3 (Copilot com `<tool_call>` em texto e travas)
- **Feito (backend):** novo módulo puro `Move-Intelligence-Back/src/modules/copilot/text-tool-calls.ts` (`extractTextToolCalls`, `stripTextToolCalls`, com variantes `arg_key`/`arg_value`, JSON interno e blocos sem fechamento) + spec de 6 casos. `chat`: pseudo-call com nome válido executa pelo `executeTool` e segue o loop; nome desconhecido (`exec`) não executa, registra `ai_call_logs` (`rejected_tool`) e refaz 1 vez com instrução curta; se persistir, resposta amigável (nunca salva/exibe markup). Sanitização final antes de salvar. `chatStream`: mesmo tratamento no tool-check; `streamWithTimeout` (timeout total `COPILOT_STREAM_TIMEOUT_MS`, padrão 60 s); vazio vira erro amigável; mensagem do assistente salva sempre; `done` garantido via `finally` (sem `await` no `return()` do gerador, que travaria). Modelo mantido (`inclusionai/ling-3.0-flash-fin:free`): sem tool calling nativo — a troca por modelo com tool calling é decisão do Raul (pode ter custo), não trocado.
- **Feito (frontend):** `CopilotService.chatStream` com `AbortController` (60 s sem evento → erro amigável) e erro quando fecha sem conteúdo; botão "Tentar de novo" (`retryLastMessage`, remove a pergunta sem resposta para não duplicar, CSS com tokens); `renderCopilotMarkdown` remove `<tool_call>` de conversas antigas + teste.
- **Arquivos da tarefa:** `Move-Intelligence-Back/src/modules/copilot/text-tool-calls.{ts,spec.ts}`, `Move-Intelligence-Back/src/modules/copilot/copilot.service.{ts,spec.ts}`, `Move-Intelligence-Front/src/app/core/services/copilot.service.ts`, `Move-Intelligence-Front/src/app/features/ai-copilot/ai-copilot.component.{ts,html,css}`, `Move-Intelligence-Front/src/app/shared/utils/markdown.util.{ts,spec.ts}`.
- **Verificação técnica:** `tsc` limpo; `jest src/modules/copilot/` 2 suítes / 28 testes (regressões a/b/c/c2 verdes); `ng build` OK; `ng test` 4/17; auditor sem novas classes (4 do ai-copilot — `assistant`, `conversation-rename`, `history-reopen`, `thinking-bubble` — são pré-existentes e saem no redesign P1-8).
- **Visual (0.2, pendente do Raul):** "ola" e "qual o produto com maior Move Score?" 5 vezes cada, sem markup e sem travar; conversa antiga do print sem `<tool_call>`; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação manual do roteiro de aceite; P0-5 (stream por conversa) complementa o frontend.

### 15/09/2026 — P0-4 (ranking 500 + ordenação)
- **Feito (backend):** `sort=rating`/`nota` virou indicador próprio (`TrendListSort` + `rating` em `TREND_SORTS`, antes alias errado de `reviews`); `dir=asc|desc` aceito em `listTrendingProducts` (padrão nome→asc, demais→desc) com comparador em base ascendente + multiplicador (desempate de `move_score` sempre por nome); `dir` na chave de cache e no controller (`@Query('dir')` repassado). Teste novo de controller com `res` Fastify (`{ header }`): `X-Total-Count` + corpo `{ items, total, page, page_size }` no paginado, sem header no array.
- **Feito (frontend):** `TrendsService.listProducts` repassa `dir`; `apiSort` manda `rating` (antes `reviews`) + `dir`; removida a reordenação local quando a resposta é paginada (só filtra o texto, preservando a ordem da API).
- **Arquivos da tarefa:** `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.{service,spec.ts,controller.spec.ts,controller.ts}`, `Move-Intelligence-Front/src/app/core/services/trends.service.ts`, `Move-Intelligence-Front/src/app/features/ranking/ranking.component.ts`.
- **Verificação técnica:** `tsc` limpo; `jest src/modules/dashboard-api/` 2 suítes / 24 testes (ordenação Nota/Preço asc/desc entre páginas verde); `ng build` OK; `ng test` 4/17.
- **Visual (0.2, pendente do Raul, pós-deploy do backend):** tabela 11 colunas, chips de faixa, paginação, `/ranking?action=DECIDIR_AGORA`, busca, Cartões; voltar do dossiê preserva página/filtro/scroll. O container backend ainda roda o bug (regra 3) — deploy é do Raul.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual pós-deploy.

### 15/09/2026 — P0-5 (Copilot para ao trocar de conversa/aba)
- **Feito (backend):** `chatStream` do service com `try/finally` — a mensagem do assistente é salva sempre, inclusive com desconexão no meio (testado: break após 1 token salva o parcial) e com erro do provedor no meio (salva o parcial e fecha com `done`). Controller com `raw.on('close')` + `safeWrite` (nunca lança em socket fechado; checa `writableEnded`/`destroyed`). Mensagem do usuário já era salva antes de gerar (`prepareConversation`, conferido).
- **Feito (frontend):** novo store `core/services/copilot-stream.store.ts` (`providedIn: 'root'`): fetch/reader fora do componente, estado por `conversationId` (`idle|thinking|streaming|error`, `partialContent`, `startedAt`, `version`), chave temporária migrada no primeiro evento, guarda por conversa, botão "Parar" via `AbortController` (só ele cancela), timeout de 60 s do P0-3 reaproveitado. Componente só lê o store (`displayMessages` = banco + parcial ao vivo), recarrega do banco ao concluir/voltar, ponto "respondendo…" no histórico, "Parar" no composer. `CopilotService.chatStream` aceita `signal` externo.
- **Arquivos da tarefa:** `Move-Intelligence-Back/src/modules/copilot/copilot.{service.spec.ts,service.ts,controller.ts}`, `Move-Intelligence-Front/src/app/core/services/{copilot-stream.store.spec.ts,copilot-stream.store.ts,copilot.service.ts}`, `Move-Intelligence-Front/src/app/features/ai-copilot/ai-copilot.component.{ts,html,css}`.
- **Verificação técnica:** `tsc` limpo; `jest` 33/286; `ng build` OK; `ng test` 5/21 (spec novo do store); auditor sem novas classes.
- **Visual (0.2, pendente do Raul):** roteiro de aceite (4 itens × 3 vezes); sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** roteiro manual P0-5; redesign visual fica para P1-8.

### 15/09/2026 — P1-1 (Executivo sem os 4 cartões, chips com "?")
- **Feito:** removida a `<section class="action-cards">`; `exec-header` movido para logo abaixo do `app-page-header`, antes da Recomendação. Cada chip de ação (4 ações + Dados insuficientes) é um `<a>` para `/ranking?action=<AÇÃO>` com bolinha de cor, rótulo, contagem e `app-hint` fora do link. Novo `shared/ui/hint/hint.component.{ts,html,css}` (`app-hint`, `input` `text`/`label`, abre em hover/foco/toque, fecha com Esc/clique fora/toque fora, `role="tooltip"` + `aria-describedby`, acima com fallback abaixo, `max-width: min(280px, 80vw)`, estilo do `.explain-popover`). `page-header` ganhou `input` opcional `hint` (reuso no P1-6; sem mudança para quem não passa). CSS: removidas `.action-cards`, `.action-card*`, `.action-name`, `.action-desc`, `.action-go`, `.hint`; chips clicáveis com hover `--surface-3` e `focus-visible`.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/shared/ui/hint/hint.component.{ts,html,css}`, `Move-Intelligence-Front/src/app/shared/ui/page-header/page-header.component.{ts,html,css}`, `Move-Intelligence-Front/src/app/features/dashboard/dashboard.component.{html,ts,css}`.
- **Verificação técnica:** `ng build` OK; `ng test` 5/21; auditor sem novas classes.
- **Visual (0.2, pendente do Raul):** topo = título → resumo (chips com "?") → Recomendação → Top 5 → Matriz; hover/foco/toque no "?" sem navegar; Tab alcança chip e "?"; 2 temas × 2 larguras.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual.

### 15/09/2026 — P1-2 (evolução com mês a mês)
- **Feito:** função pura `shared/util/series.ts` (`aggregateMonthly`: volume soma, preço média, reviews = novas no mês com `reviewCreatedInMonth`; mês incompleto sem cobrir o mês cheio vira `parcial`, sem extrapolar; rótulo `jul/26`) + spec de 7 casos. `adoption-curve-chart`: faixa "Mês a mês" com rolagem horizontal (valor + `▲/▼/—` contra o anterior, `parcial` marcado), tooltip com "vs semana anterior" e "vs mesmo período do mês anterior" (referência por data ±3 dias, omitido sem base), chip `+N%` com "na janela" + segundo chip "último mês vs anterior", janela `7d` esconde a faixa com "Selecione 60d ou mais para comparar meses". Dossiê: `dist-empty` em linha única sem distribuição; `[window]` ligado ao gráfico.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/shared/util/series.{ts,spec.ts}`, `Move-Intelligence-Front/src/app/shared/components/intel/adoption-curve-chart/adoption-curve-chart.component.{ts,html,css}`, `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.{ts,html,css}`.
- **Verificação técnica:** `ng build` OK; `ng test` 6/28; auditor sem novas classes (`month-tag` estilizado). Conferência à mão no spec: jul 31×10=310, ago 31×20=620 → +100%.
- **Visual (0.2, pendente do Raul):** aba Adoção em 6m nas 3 métricas (gráfico + chips + faixa mensal); sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual (2 meses conferidos no spec).

### 15/09/2026 — P1-3 ("Radar de sub-sinais" vazio)
- **Achado (backend, item 4):** duplo — (1) sem `demand_links` coletados no produto de teste (falta de coleta) **e** (2) divergência de chaves: `getTrendProduct` devolve `signals` como `{source_geo: {value…}}` (`demandToSignals`), enquanto o card filtrava só as 6 chaves do breakdown antigo (`marketplaceGrowth`…), removido do contrato na F2.7. Ou seja, mesmo com coleta o radar ficaria zerado. Sem inventar dado, a correção é no frontend.
- **Feito (frontend):** card genérico sobre o que a API devolve — `dimensions()` com as 6 chaves conhecidas + `humanize` de fallback; cabeçalho com contagem real (`N dimensões`); 0 → "Sub-sinais ainda não calculados para este produto" + 6 dimensões esperadas em cinza; 1–2 → barras 0–100; 3+ → radar.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/shared/components/intel/opportunity-radar/opportunity-radar.component.{ts,html,css}`.
- **Verificação técnica:** `ng build` OK; auditor sem novas classes.
- **Visual (0.2, pendente do Raul):** card nunca vazio; com dados, radar/barras com as dimensões certas; sem login nesta sessão.
- **Queries para o Raul:** nenhuma (coleta de demanda segue pendente no pipeline).
- **Pendências:** verificação visual com produto com coleta.

### 15/09/2026 — P1-4 (busca não acha termo parcial)
- **Feito (backend):** filtro trocado por `word_similarity` (`<%`) **ou** `ILIKE '%termo%'` nos caminhos 1 (unaccent) e 2 (sem unaccent), ordenando por `contains DESC, sim DESC` (prioridade a quem contém); caminho 3 (Prisma) com termo original e normalizado em nome, categoria e fornecedor. Testes: SQL com `word_similarity` + `ILIKE`; fallback `YOGA` maiúsculo → "Tapete de Yoga" (OR com 4 condições).
- **Feito (frontend):** categoria da palette leva a `/ranking?q=<categoria>` (URL com filtro, já suportado).
- **Arquivos da tarefa:** `Move-Intelligence-Back/src/modules/dashboard-api/dashboard-api.service.{ts,spec.ts}`, `Move-Intelligence-Front/src/app/shared/ui/command-palette/command-palette.component.ts`.
- **Verificação técnica:** `tsc` limpo; `jest src/modules/dashboard-api/` 2/26; `ng build` OK.
- **Visual (0.2, pendente do Raul, pós-deploy do backend):** "halter" → Halteres, "esteira" → Walking Pad, "yoga" → Tapete de Yoga na palette; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação na palette pós-deploy.

### 15/09/2026 — P1-5 (abas Decisão e Simulação do dossiê)
- **Feito:** auditor restrito ao template do dossiê sem classes faltando; sem vocabulário antigo no template (`Avançar`/`Reprovar`/`Trend Score`/`Opportunity Score` só como nome de import do radar e chave de `signalLabel`). Correção: "Risco" da Simulação com fallback "—" (o script não devolve mais `risk_level` desde B1; vazio honesto em vez de célula em branco). Aba Decisão coberta pelo P0-2 (cartão sem JSON, sem "monitorar", sem frases fixas).
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/features/tendencia/tendencia.component.html`.
- **Verificação técnica:** `ng build` OK; auditor do dossiê OK.
- **Visual (0.2, pendente do Raul):** abrir Decisão e Simulação no dossiê de teste, 2 temas; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual das duas abas.

### 15/09/2026 — P1-6 ("?" ao lado do título do AI Copilot)
- **Feito:** `page-header` com `input` opcional `hint` (reuso do `app-hint` do P1-1, ao lado do `<h1>`, sem mudar quem não passa); `ai-copilot` trocou `subtitle` por `hint` com o texto pedido. "Nova conversa" já estava na linha do título (`copilot-header-actions`); conferir 400 px fica no visual.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/shared/ui/page-header/page-header.component.{ts,html,css}`, `Move-Intelligence-Front/src/app/features/ai-copilot/ai-copilot.component.html`.
- **Verificação técnica:** `ng build` OK.
- **Visual (0.2, pendente do Raul):** "AI Copilot ?" sem subtítulo, 2 temas; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Sugestão (item 3, para o Raul decidir):** aplicar o mesmo padrão `hint` em Ranking, Sourcing e Sinais, cujos subtítulos são longos — não aplicado agora.
- **Pendências:** verificação visual.

### 15/09/2026 — P1-7 (sidebar no padrão do vídeo + breadcrumb discreto)
- **Feito:** `LayoutService.paletteRequest` + top-bar abre a palette via `effect` (ícone de busca da sidebar). Top-bar sem controle de sidebar no desktop (hambúrguer `bars` só ≤1024 px); breadcrumb discreto (`--text-3`/`--text-2`, sem caixa alta, sem hover) e escondido em desktop (só compacto; título já está no `page-header`); `title="Expandir"` do botão de conta removido. Sidebar: cabeçalho com marca + busca + painel ("Fechar barra lateral"); rail com hover no logo trocando para painel + tooltip "Abrir barra lateral" (clique expande, sem navegar); tooltips à direita nos itens (CSS, via `aria-label`, sem `title` nativo); rótulos de seção discretos; ativo/hover só com fundo sutil (sem barra verde); "em breve" em texto; transição com `prefers-reduced-motion`; gaveta compacta com fechar fora. Ação "Alternar sidebar" da palette intacta.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/core/services/layout.service.ts`, `Move-Intelligence-Front/src/app/shared/layout/{top-bar/top-bar.component.{ts,html,css},app-sidebar/app-sidebar.component.{html,ts,css}}`, `Move-Intelligence-Front/src/app/shared/ui/icon/icon.component.ts` (`arrow-left`).
- **Verificação técnica:** `ng build` OK; auditor sem novas classes (`sidebar-toggle` e `brand-close`/`brand-search` definidos).
- **Visual (0.2, pendente do Raul):** aceite desktop/400 px/teclado/temas; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** item 6 (rodapé da sidebar com conta) NÃO feito — mover o menu de conta exige refatorar notificações/conta/logout da top-bar; fica para o Raul decidir; verificação visual.

### 15/09/2026 — P1-8 (AI Copilot com visual limpo de chat)
- **Feito:** estado vazio centralizado (saudação "Pergunte sobre produtos, scores e fornecedores", composer em pílula logo abaixo, 3–4 sugestões como linhas com ícone + texto); com mensagens em coluna 760 px — assistente sem card (texto direto + "Move AI" pequeno em `--text-3`, hora só no hover), usuário em bolha discreta à direita (`--surface-2`, `--r-lg`, 80%, sem verde neon; verde só no enviar/foco); composer em pílula (`--surface-2`, cantos plenos, "+" desativado "Em breve", enviar circular) fixo no rodapé; "Parar" no lugar do enviar (P0-5); histórico sem card ("Recentes" simples, ativo sutil, ações em menu "⋯" no hover, recolher com painel "Fechar/Abrir histórico", "Nova conversa" como item do topo); mobile com gaveta + backdrop; markdown e timeout do P0-3 mantidos.
- **Arquivos da tarefa:** `Move-Intelligence-Front/src/app/features/ai-copilot/ai-copilot.component.{html,ts,css}`.
- **Verificação técnica:** `ng build` OK; `ng test` 6/28; auditor zerado para o ai-copilot.
- **Visual (0.2, pendente do Raul):** prints 2 temas × 2 larguras; sem login nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual.

### 15/09/2026 — P2 (acabamento)
- **P2-1:** "Trend Score Mínimo" removido (campo morto: o backend nunca usa `minTrendScore` no scan); entra "Variação do Move Score (pontos)" (`minMoveScoreDelta`, default 10, em efeito no C8) + nota de que o disparo é por mudança de **ação**; grid em `repeat(auto-fit, minmax(200px, 1fr))` com rótulos em cima.
- **P2-2:** classes com função e sem CSS estilizadas — `notification-menu`/`account-menu` (rolagem), `competitors-grid` (grade), `status-indicator` (linha), `head-left` (coluna do título); `table-view` do ranking removida (sem função: o seletor de elemento já controla).
- **P2-3:** `echarts-theme` com `success`/`warning`/`info` lidos dos tokens; matriz usa as cores do tema (legenda reativa a troca de tema; "Dados insuficientes" em `--text-3`, visível nos dois temas); chips de faixa já com fundo `*-bg` e contraste; tracejada do anterior em `--text-3`.
- **P2-4:** revisado por código — tabelas com rolagem interna (`.table-shell`, `.table-wrap`), `body` sem rolagem horizontal global, dossiê com 1/2 colunas e abas com rolagem, faixa mensal com rolagem, pager com quebra, ranking vira Cartões ≤767 px, Copilot com gaveta + backdrop; sem viewport de 400 px nesta sessão para confirmar.
- **P2-5:** cartão com rótulo "Move Score" + chip de ação + "Faixa Verde/Amarela/Vermelha" (`scoreBandLabel`) + seta, sem quebra com ação longa.
- **Arquivos da tarefa:** sinais (`sinais.component.{html,ts,css}`), `echarts-theme.ts`, `quadrant-bubble.component.ts`, `trend-card.component.{html,ts,css}`, `top-bar.component.css`, `competitor-matrix.component.css`, `seasonality-forecast.component.css`, `ranking.component.html`.
- **Verificação técnica:** `tsc` limpo; `jest` 33/288; `ng build` OK; `ng test` 6/28; **auditor zerado** (inclusive as classes pré-existentes da linha de base).
- **Visual (0.2, pendente do Raul):** tema claro em todas as telas + 400 px sem rolagem no `body`; sem login/viewport nesta sessão.
- **Queries para o Raul:** nenhuma.
- **Pendências:** verificação visual (claro + 400 px).

### 15/09/2026 — Checkpoint final (P0 → P1 → P2, código)
- **Verificação 0.1 (saída real, nesta sessão):** backend `prisma generate` OK + `tsc` limpo + `jest` 33 suítes / 288 testes; frontend `ng build` OK + `ng test` 6 arquivos / 28 testes; `run_tests.py` 7 OK; `pytest` 79 passando + 3 pulados; `scripts/tests` 6 passed; **auditor zerado** (nenhuma classe sem CSS, nem pré-existente).
- **Requisições pagas:** 0 em todas as tarefas (código + mocks; nenhum scrape/IA real; modelo OpenRouter não trocado).
- **Docker:** só o `frontend` reconstruído (`docker compose up -d --no-deps --build frontend`, servindo 200); `backend`/`postgres`/`redis` não tocados (regra 3); API responde 401 sem login, como esperado.
- **Migrações:** nenhuma aplicada; nenhuma escrita em banco.
- **Para o Raul (visual 0.2, com login):** P0-1 (5× F5 no dossiê + clique do Ranking + 400 px); P0-2 (aba Decisão); P0-3 (roteiro "ola"/ranking 5× + conversa antiga); P0-4 (ranking pós-deploy do backend); P0-5 (roteiro 4 itens × 3); P1-1/P1-6/P1-7/P1-8 (2 temas × 2 larguras); P1-2 (2 meses conferidos no spec); P2 (claro + 400 px).
- **Para o Raul (decisões/dados):** aplicar migrações pendentes + rebuild do backend + lote de score (pré-requisito §2); escolher modelo OpenRouter com tool calling (P0-3); rodar a limpeza de `ai_recommendations` (P0-2); decidir `hint` em Ranking/Sourcing/Sinais (P1-6 item 3) e rodapé da sidebar com conta (P1-7 item 6).
- **Plano executado no código (P0-2 → P2). Aguardar aprovações visuais do Raul.**

### 15/09/2026 — Adendo (revisão de gaps sem Raul)
- **P1-8 mobile:** o botão "⋯" do histórico só aparecia no hover — indescobrível no toque. Regra `@media (hover: none)` deixando-o sempre visível; frontend reconstruído (`frontend:200`).
- **Revisão item a item do aceite:** P0-2 (ação das regras mantida mesmo com JSON válido divergente; falha salva fallback válido, sem loop de chamadas); P0-5 (abort sem reload fantasma; retry sem duplicar pergunta); P1-8 (nomes `ngModel` únicos nos dois composers; `effect` da palette só abre com pedido > 0).
- **Verificação:** `ng build` OK; `ng test` 6/28; auditor zerado.
- **Queries para o Raul:** nenhuma.
