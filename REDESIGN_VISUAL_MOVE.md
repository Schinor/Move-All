# Redesign Visual — Move Intelligence

**Documento de execução para agente de IA.**
Contém a análise de design completa da plataforma, a identidade visual oficial extraída do brand
book da Move e as instruções passo a passo para implementar o novo visual.

- **Escopo:** `Move-Intelligence-Front/` (Angular 21, standalone, CSS puro, ECharts).
- **Fora de escopo:** backend, pipeline de dados, contratos de API, lógica de negócio.
- **Idioma da UI:** pt-BR.
- **Fonte da identidade:** `InovaSkills - Move iD_compressed.pdf` (arquivo temporário na raiz — **não commitar**).

---

## 0. PRIMEIRO PASSO OBRIGATÓRIO — CRIAR BRANCH

> **Não altere nada antes de executar esta etapa.**
> Todo o redesign é experimental e deve ficar isolado para poder ser avaliado e descartado sem risco.

```bash
cd /Users/raul/Desktop/Move-All
git status                      # confirme o estado atual
git checkout develop
git pull --ff-only              # se houver remote configurado
git checkout -b feat/redesign-visual-move-brand
```

Regras da branch:

1. **Nunca commitar direto em `develop`.** Todo commit deste trabalho vai para `feat/redesign-visual-move-brand`.
2. **Não commitar o PDF.** Confirme que `InovaSkills - Move iD_compressed.pdf` está fora do commit
   (adicione ao `.gitignore` se necessário). O arquivo é temporário e pertence ao cliente.
3. Commits pequenos e semânticos, em português, um por bloco de trabalho. Sugestão de sequência:
   - `feat(design-system): substitui tokens por paleta oficial da marca Move`
   - `feat(design-system): carrega e aplica tipografia da marca`
   - `refactor(layout): reconstrói sidebar, topbar e shell da aplicação`
   - `refactor(dashboard): substitui hero de marketing por painel de decisão`
   - `refactor(ui): normaliza cards, tabelas, formulários e estados`
   - `feat(a11y): foco visível, reduced-motion e contraste AA`
   - `chore(ui): remove dados fictícios da interface`
4. Ao final, **não faça merge**. Deixe a branch pronta para revisão e informe ao usuário:
   - o que foi feito,
   - como rodar (`cd Move-Intelligence-Front && npm start`),
   - quais telas mudaram,
   - o que ficou pendente.

---

## 1. Contexto do produto

Move Intelligence é uma plataforma **B2B interna de inteligência de mercado** usada por times de
produto/compras da Move (marca de fitness da Movement) para responder uma pergunta:
**“vale a pena lançar/comprar este produto agora?”**

- **Usuário:** analista, gerente de produto, comprador. Uso diário, sessões longas, muita leitura de
  dado numérico e comparação.
- **Não é** um site de marketing. **Não é** um app de consumo. É uma ferramenta de trabalho.
- Consequência de design: densidade informacional alta, hierarquia rígida, zero ornamento gratuito,
  leitura confortável por horas, números sempre tabulares e alinhados.

### Rotas existentes (10 + auth + 404)

| Rota | Tela | Estado |
|---|---|---|
| `/` | Executivo (dashboard) | funcional |
| `/ranking` | Ranking de tendências | funcional |
| `/comparador` | Comparador lado a lado | funcional |
| `/sinais` | Sinais & alertas | funcional |
| `/ai-copilot` | AI Copilot | funcional |
| `/sourcing` | Sourcing & fornecedores | funcional |
| `/tendencia/:id` | Dossiê do produto | funcional |
| `/mercados` | Mercados | **em desenvolvimento** |
| `/pipeline` | Pipeline de decisão | **em desenvolvimento** |
| `/recomendacoes` | Recomendações | **em desenvolvimento** |
| `/login`, `/cadastro` | Autenticação | mock (sem AuthService) |
| `**` | 404 | funcional |

---

## 2. Identidade visual oficial da Move (extraída do brand book)

### 2.1 Paleta institucional

A página de paleta do brand book define os seguintes valores. **Há uma divergência entre o hex
impresso no rótulo e a cor real do swatch** (o arquivo contém um verde mais saturado do que o hex
escrito). Todas as aplicações reais da marca — logo em fachada, produtos, mídia — usam o verde
saturado. **Use o valor amostrado do arquivo e sinalize a divergência ao usuário para confirmação
com o time de marca.**

| Papel | Pantone | Hex a usar (amostrado) | Hex escrito no manual |
|---|---|---|---|
| Preto institucional | Black 6 C | `#000000` | `#000000` |
| Cinza institucional | 425 C | `#54585B` | `#545859` |
| **Verde Move (primária)** | **Neon 802 C** | **`#75F852`** | `#a7f860` ⚠️ divergente |
| Verde secundário | 3395 C | `#03EB88` | `#85eb8b` ⚠️ divergente |
| Amarelo | — | `#FDE441` | `#f6e152` |
| Rosa/vermelho | — | `#FD4664` | `#dc4664` |
| Roxo | — | `#8C7BFF` | `#8579f9` |
| Azul claro | — | `#83E1FA` | `#82e1f8` |

**Fato crítico de contraste:** o verde `#75F852` tem luminância ~0.72. Contra preto → ~15:1
(excelente). Contra branco → ~1.4:1 (**ilegível**).

> **Regra inegociável:** o verde Move nunca é usado como texto sobre fundo claro, e nunca recebe
> texto branco por cima. Sobre verde, o texto é **preto**. Isso é exatamente o que o brand book faz
> (logo preto sobre bloco verde, logo verde sobre bloco preto). No tema claro, textos e links em
> “verde” usam a variante escurecida `#2C6B18`.

### 2.2 Tipografia

- **Fonte oficial da marca: `Termina`** (Fort Foundry — licença comercial paga).
  Grotesca geométrica, técnica, terminais retos. É a fonte especificada no manual.
- **Se a licença web da Termina estiver disponível:** self-host em `public/fonts/` com `@font-face`
  e use nos títulos (Display/H1/H2).
- **Se não estiver disponível (assuma este cenário):** use **Archivo** (Google Fonts, variável) como
  substituto de display. É a alternativa livre mais próxima em construção geométrica e largura.
- **Corpo/UI:** **Inter** (já declarada no CSS atual, mas **nunca carregada** — hoje o app cai no
  system font). Inter tem `tabular-nums` e boa legibilidade em densidade alta.
- **Não usar** JetBrains Mono. Números tabulares saem do Inter com `font-variant-numeric: tabular-nums`.
  Menos uma fonte carregada.

### 2.3 Logo e símbolo

- Logotipo: wordmark `MOVE` com o `M` cortado a 15°.
- Símbolo: o `M` isolado (usado como ícone/avatar/favicon).
- **Usos proibidos pelo manual** (respeitar na UI): não rotacionar, não distorcer, não alterar
  proporção, **não aplicar degradê**, **não aplicar sombra**, não recolorir fora da paleta, não
  alterar a fonte do logotipo.
- Existe `Move-Intelligence-Front/public/logo-plataforma.webp` **não referenciado em lugar nenhum**.
  Avalie usá-lo; se não servir, gere um SVG do símbolo `M` (monocromático, `currentColor`) em
  `src/app/shared/ui/brand-mark/`.
- **Hoje a sidebar e o login desenham a letra “M” em um quadrado com gradiente verde-azul.** Isso
  viola diretamente as regras 6 e 8 do manual. Deve ser substituído pelo símbolo real.

### 2.4 Elemento gráfico de identidade

O manual define um recurso de identidade: **traços/lâminas angulares finas em verde**, aplicados como
“respiro lateral” — reconhecíveis mesmo sem o logo. É a única ornamentação autorizada.

Na UI, traduza isso com **moderação extrema**: uma barra/linha angular verde de 2–3px como marcador
de seção ativa ou detalhe de canto em telas de entrada (login, 404, estado vazio inicial).
**Não** transformar em textura de fundo, não repetir em todo card.

### 2.5 Tom de voz (do manual)

Escala do manual: despojada, divertida, simples, flexível (todas puxadas para o lado informal);
intensa→linear no meio; **leiga→técnica levemente para o técnico**; **positiva** (extremo).

Tradução para microcopy do produto:

- Direto e curto. Frase ativa. Sem jargão de consultoria.
- Explica o número antes de assumir que o usuário sabe lê-lo.
- Erros são positivos e acionáveis: “Não conseguimos carregar o ranking. Tentar de novo” — não
  “Erro 500: falha interna”.
- Zero superlativo de marketing dentro do produto (“revolucionário”, “antes do mainstream”).

---

## 3. Diagnóstico da plataforma atual

Auditoria feita sobre o código (`Move-Intelligence-Front/src/`) e sobre a aplicação rodando.

### 3.1 🔴 Bloqueadores de credibilidade — dados fictícios na interface

A plataforma é para **uso real**. Hoje há dados inventados apresentados como fato:

| Local | Conteúdo falso |
|---|---|
| `top-bar.component.html` | Usuário fixo “Rafael Brudden / Diretor de Produto”, avatar “RB” |
| `top-bar.component.html` | “Mercado Aberto”, “BRL · Atualizado há 2min · 14h32 BRT” (string estática) |
| `app-sidebar.component.html` | “Trend OS · v2.4”; “Sinais ao vivo — ” com contador `—` fixo |
| `login.component.html` | “12k+ produtos rastreados”, “94% precisão de sinais”, “48h antes do mercado” |
| `tendencia.component.html` | “Confiança: 96% Alta” hardcoded; “Status Pipeline: Em Sourcing” hardcoded; `signalEntries().length \|\| 12` |
| `ranking.component.html` | Colunas “Margem”, “Lead”, “Pipeline” retornando `—` fixo em toda linha |

**Ação:** remover tudo. Onde o dado real ainda não existe, ou omitir o elemento, ou exibir estado
vazio honesto. Nunca inventar número.

### 3.2 🔴 Arquitetura de informação quebrada

- **A sidebar tem 6 itens; existem 10 rotas de produto.** `/mercados`, `/pipeline` e `/recomendacoes`
  são inalcançáveis pela navegação — só por URL direta. Funcionalidade invisível = funcionalidade
  inexistente.
- Um único grupo `WORKSPACE` para tudo, sem agrupamento por intenção.
- Sem breadcrumb. Em `/tendencia/:id` o usuário não sabe de onde veio nem como voltar ao ranking.
- Sem indicação de qual módulo está em desenvolvimento — o usuário descobre clicando e achando vazio.

### 3.3 🔴 Promessas de interface que não funcionam

Afordâncias visíveis que não fazem nada. É a principal causa de “como usa isso?”:

- Campo de busca global na topbar: `<input>` solto, sem handler. Não busca nada.
- Badge `⌘K` ao lado dele: sugere command palette. Não existe atalho.
- Botão “Ask Move AI”: sem `(click)`. Não abre nada.
- Sino de notificações com badge vermelho permanente: sem `(click)`, sem painel.
- “Briefing AI semanal” no dashboard: sem `(click)`.
- “Esqueceu a senha?” → `href="#"`.
- Login/cadastro: `setTimeout` de 1,5s e nada acontece. Sem `AuthService`, sem guard, sem sessão.
- Ranking: `sort('score')` no cabeçalho “Rank” **e** em “Score” (mesmo campo), sem indicador de
  direção de ordenação.

### 3.4 🟠 Aparência de “plataforma gerada por IA”

Inventário dos sinais genéricos presentes hoje:

1. **Glows radiais fixos no `<body>`** (`styles.css`) — dois gradientes radiais verde/azul com
   `background-attachment: fixed`.
2. **Hero de landing page dentro do app logado** — badge pill + headline de 3rem + gradiente no
   texto + dois CTAs + `hero-bg-grid` + `hero-glow-a/b` com `filter: blur(64px)`.
3. **Texto em gradiente** (`.text-gradient`) em headline e no “404”.
4. **Botão primário com gradiente** (`--gradient-primary`) — viola regra 6 do manual.
5. **Glassmorphism como padrão de card** — `.glass` com `backdrop-filter: blur(14px) saturate(140%)`
   aplicado em ~todo card da aplicação. Custo de render alto e leitura pior.
6. **Ticker/marquee infinito** no dashboard (`animation: marquee 40s linear infinite`).
7. **Orbs decorativos** no login (`.bg-orb-1/2`) + grid de fundo.
8. **Raio de borda alto e uniforme** (`--radius: 0.75rem`, até `1.25rem`) — arredondamento de tudo.
9. **Paleta teal/esmeralda genérica** — `oklch(0.78 0.18 158)` ≈ verde-menta/teal. **Não é a cor da
   Move.** É o verde padrão de template SaaS.
10. **Pulsos infinitos** — `pulse` no dot da sidebar, `blink` no dot da topbar, sem propósito.

### 3.5 🟠 Design system inconsistente

- **`--font-display` === `--font-sans` === Inter.** Não existe hierarquia tipográfica real; a
  distinção é só peso/tamanho.
- **Nenhuma fonte é carregada.** Sem `@font-face`, sem `<link>` no `index.html`. `Inter` e
  `JetBrains Mono` são declaradas e ignoradas — o app renderiza em system-ui.
- Escala de raio com 6 valores derivados; escala de espaçamento inexistente (valores ad hoc:
  `0.65rem`, `0.35rem`, `1.75rem`, `0.62rem`...).
- Tamanhos de fonte arbitrários e não escalonados: `0.62`, `0.65`, `0.7`, `0.72`, `0.78`, `0.82`,
  `0.85`, `0.86`, `0.9`, `0.95rem` — dez tamanhos abaixo de 1rem.
- CSS por componente sem primitivas compartilhadas: `.btn-primary`, `.btn-ghost`, `.btn-submit`,
  `.btn-oauth`, `.btn-scan`, `.btn-test`, `.btn-save`, `.btn-detail`, `.btn-clear`, `.btn-sidebar`,
  `.pill-btn`, `.chip-btn`, `.metric-btn`, `.export-btn`, `.go`, `.ask`, `.icon-btn` — **17 estilos
  de botão** para ~5 papéis reais.
- Idem para input: cada tela reestiliza o seu.

### 3.6 🟠 Acessibilidade

Verificado no código-fonte:

| Item | Resultado |
|---|---|
| `:focus-visible` | **0 ocorrências** em todo o `src/` |
| `prefers-reduced-motion` | **0 ocorrências** (há 5 animações infinitas) |
| `prefers-color-scheme` | **0 ocorrências** |
| Alvo de toque mínimo 44px | Não atendido (botões de 36px, `.why` de 18px) |
| Contraste `--muted-foreground` sobre `--surface` | ~3.4:1 — **abaixo de AA (4.5:1)** para texto normal |
| Tamanho mínimo de texto | `0.62rem` ≈ 10px em labels e metadados — abaixo do confortável |
| Tabela do ranking | Sem `scope` nos `<th>`, sem `aria-sort` |
| Botão `.why` do KPI | Rótulo textual é “?”, sem `aria-controls` para a região expandida |

### 3.7 🟡 Responsividade

- **Sidebar colapsada some por completo no desktop** (`:host(.sidebar-collapsed) { display: none }`).
  Não há modo “rail” só com ícones — o usuário perde toda a navegação e o contexto de onde está.
- `app-content` tem `padding: 1.75rem` fixo em qualquer viewport.
- Tabelas com `min-width: 1040px` dentro de scroll horizontal: funciona, mas no mobile o usuário
  arrasta às cegas (sem coluna fixa, sem indicador de scroll).
- Breakpoints inconsistentes entre arquivos: 560, 900, 1024 — sem escala definida.
- Dashboard e comparador viram uma coluna, mas a densidade não é repensada — é só desktop espremido.

### 3.8 🟡 Ícones quebrados

O `IconComponent` tem um `@default` que renderiza um círculo com “!” (ícone de alerta genérico).
**10 nomes são usados mas não existem** — e portanto renderizam o ícone de alerta:

`arrow-up-right`, `command`, `email`, `empresa`, `flame`, `nome`, `password`, `search`, `sparkles`, `terms`

Isso é visível na tela: o badge “Inteligência em tempo real”, a lupa da busca, o `⌘K`, o botão
“Ask Move AI”, o alternador de tema e o eyebrow “Oportunidades em destaque” **todos mostram o mesmo
ícone de alerta**. Parece bug — e é.

Além disso, 10 ícones estão definidos e nunca são usados: `check-circle`, `chevron-down`,
`chevron-up`, `clock`, `medal-bronze`, `money`, `pin`, `pin-filled`, `trending-up`, `x-circle`.

### 3.9 🟡 Tema claro

- Existe como “Aproximação” (comentário no próprio CSS) — inversão de superfícies mantendo o verde.
- **Não persiste.** `ThemeService` não usa `localStorage`; recarregar volta para dark.
- Não respeita `prefers-color-scheme`.
- Componentes com cores hardcoded quebram: `rgba(0,0,0,0.55)` no backdrop, `rgba(0,0,0,0.26)` na
  sombra da sidebar, `oklch(1 0 0 / 0.03)` no grid do hero.
- O verde primário `#75F852`/teal atual sobre superfície clara fica ilegível (ver §2.1).

---

## 4. Direção de design nova

### 4.1 Princípios

1. **Preto de verdade, verde com parcimônia.** A base é neutra (preto/cinza/branco). O verde Move é
   um sinal — marca o estado ativo, a ação primária e o dado positivo. Nunca é ambiente.
2. **A borda substitui a sombra.** Separação por `1px solid var(--border)`. Sombra só em overlays
   (modal, popover, dropdown).
3. **Superfície sólida, não vidro.** `backdrop-filter` só na topbar fixa e em overlays.
4. **Geometria técnica.** Raios pequenos (2–10px). A marca é angular (o corte de 15° do `M`),
   não “pill”.
5. **Densidade tabular.** Números sempre `tabular-nums`, alinhados à direita, com unidade explícita.
6. **Movimento serve à compreensão.** 120–200ms, `ease-out`, em mudança de estado. Zero animação
   infinita decorativa.
7. **Nada de placeholder decorativo.** Se o dado não existe, o estado vazio explica e oferece ação.

### 4.2 Tokens — reescreva `src/styles.css` inteiro

```css
/* ============================================================
   Move Intelligence — Design System
   Base: identidade Move (preto / branco / Neon 802 C).
   ============================================================ */

:root {
  /* ---- Tipografia ---- */
  --font-display: 'Termina', 'Archivo', 'Inter', system-ui, sans-serif;
  --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;

  /* Escala tipográfica — 8 degraus, sem exceções */
  --fs-display: 2.25rem;  --lh-display: 2.5rem;   /* 36/40  */
  --fs-h1:      1.75rem;  --lh-h1:      2.125rem; /* 28/34  */
  --fs-h2:      1.25rem;  --lh-h2:      1.75rem;  /* 20/28  */
  --fs-h3:      1rem;     --lh-h3:      1.5rem;   /* 16/24  */
  --fs-body:    0.875rem; --lh-body:    1.375rem; /* 14/22  */
  --fs-sm:      0.8125rem;--lh-sm:      1.25rem;  /* 13/20  */
  --fs-caption: 0.75rem;  --lh-caption: 1rem;     /* 12/16  */
  --fs-label:   0.6875rem;--lh-label:   1rem;     /* 11/16  */

  /* ---- Espaçamento — escala única ---- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* ---- Raio ---- */
  --r-xs: 2px; --r-sm: 4px; --r-md: 6px; --r-lg: 10px; --r-full: 999px;

  /* ---- Elevação (só overlay) ---- */
  --shadow-popover: 0 4px 16px rgba(0,0,0,.32);
  --shadow-modal:   0 16px 48px rgba(0,0,0,.48);

  /* ---- Movimento ---- */
  --dur-fast: 120ms; --dur-base: 180ms; --ease: cubic-bezier(.2,0,.2,1);

  /* ---- Layout ---- */
  --sidebar-w: 240px; --sidebar-rail-w: 60px; --topbar-h: 56px;
  --content-max: 1440px;

  /* ============ TEMA CLARO (padrão do :root) ============ */
  --bg:            #FFFFFF;
  --bg-subtle:     #F7F7F8;
  --surface:       #FFFFFF;
  --surface-2:     #F4F4F5;
  --surface-3:     #EBEBED;
  --border:        #E3E3E6;
  --border-strong: #C9C9CE;
  --text:          #0A0A0B;
  --text-2:        #55565C;   /* 7.1:1 sobre --surface */
  --text-3:        #7A7B82;   /* 4.6:1 — mínimo AA     */

  --brand:      #75F852;  /* fills; texto por cima é PRETO */
  --brand-ink:  #000000;
  --brand-text: #2C6B18;  /* texto/link "verde" no claro — 6.6:1 sobre branco */
  --brand-weak: #EAFDE2;  /* fundo de destaque sutil */

  --success: #17803D; --success-bg: #E9F7EE;
  --warning: #8A6A00; --warning-bg: #FEF8E0;
  --danger:  #C42945; --danger-bg:  #FDEAEE;
  --info:    #1B6E86; --info-bg:    #E6F7FC;

  --chart-1: #35B81A; --chart-2: #1B7F9E; --chart-3: #6B57D9;
  --chart-4: #B08900; --chart-5: #C42945; --chart-6: #54585B;

  --focus-ring: #1B6E86;
  color-scheme: light;
}

/* ============ TEMA ESCURO ============ */
:root[data-theme='dark'] {
  --bg:            #0A0A0B;
  --bg-subtle:     #0F0F11;
  --surface:       #141416;
  --surface-2:     #1B1B1E;
  --surface-3:     #232327;
  --border:        #2A2A2F;
  --border-strong: #3C3C43;
  --text:          #F4F4F5;
  --text-2:        #A6A6AE;   /* 7.4:1 sobre --surface */
  --text-3:        #77777F;   /* 4.6:1 — mínimo AA     */

  --brand:      #75F852;
  --brand-ink:  #000000;
  --brand-text: #75F852;      /* 15:1 sobre --bg — pode ser texto no escuro */
  --brand-weak: #16250F;

  --success: #03EB88; --success-bg: #062218;
  --warning: #FDE441; --warning-bg: #241F05;
  --danger:  #FD6C82; --danger-bg:  #2A0E14;
  --info:    #83E1FA; --info-bg:    #06222B;

  --chart-1: #75F852; --chart-2: #83E1FA; --chart-3: #8C7BFF;
  --chart-4: #FDE441; --chart-5: #FD6C82; --chart-6: #8B8B93;

  --focus-ring: #83E1FA;
  --shadow-popover: 0 4px 16px rgba(0,0,0,.6);
  --shadow-modal:   0 16px 48px rgba(0,0,0,.72);
  color-scheme: dark;
}

/* Preferência do sistema quando o usuário não escolheu (sem data-theme). */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* repita aqui EXATAMENTE o bloco de :root[data-theme='dark'] */
  }
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0; min-height: 100%;
  background: var(--bg);
  color: var(--text);
}

body {
  font-family: var(--font-sans);
  font-size: var(--fs-body);
  line-height: var(--lh-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  /* SEM background-image, SEM gradiente, SEM glow. */
}

.num { font-variant-numeric: tabular-nums; }

:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--r-sm);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Remova de `styles.css`:** `.glass`, `.glass-strong`, `.text-gradient`, `--gradient-primary`,
`--gradient-surface`, `--shadow-glow`, os `background-image` radiais do `body`, e toda a paleta oklch
antiga. Ajuste os seletores de scrollbar para usar `var(--border-strong)`.

### 4.3 Carregar as fontes

Em `src/index.html`, dentro do `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Archivo:wght@500;600;700&display=swap">
```

**Preferível (produção):** self-host. Instale `@fontsource-variable/inter` e
`@fontsource-variable/archivo`, importe em `styles.css`, e remova o `<link>`. Elimina a dependência
de terceiro, o FOUT de rede e o risco de privacidade.

Se a licença web da **Termina** for obtida: coloque os `.woff2` em `public/fonts/`, declare
`@font-face` com `font-display: swap`, adicione `<link rel="preload" as="font" crossorigin>` para o
peso 600, e mantenha Archivo como fallback na stack.

### 4.4 Tema — corrigir o `ThemeService`

`src/app/core/services/theme.service.ts` deve:

1. Ler a preferência de `localStorage` (`move:theme`), com `try/catch`.
2. Se não houver preferência salva, **não estampar `data-theme`** — deixar o
   `prefers-color-scheme` decidir.
3. Suportar 3 estados: `'light' | 'dark' | 'system'`. O botão da topbar cicla entre eles com
   `aria-label` descrevendo o estado atual.
4. Persistir a escolha explícita.
5. Aplicar antes do primeiro paint (script inline curto em `index.html` para evitar flash).

---

## 5. Instruções por área

### 5.1 Sidebar (`shared/layout/app-sidebar/`)

**Navegação nova, agrupada por intenção. Todas as 10 rotas presentes.**

```
[marca Move]

DECIDIR
  Executivo            /              (exact)
  Ranking              /ranking
  Comparador           /comparador

INVESTIGAR
  Sinais & Alertas     /sinais
  Mercados             /mercados       · em breve
  AI Copilot           /ai-copilot

EXECUTAR
  Sourcing             /sourcing
  Pipeline             /pipeline       · em breve
  Recomendações        /recomendacoes  · em breve

[rodapé: status das fontes de dados — real, ou oculto]
```

Requisitos:

1. **Módulos em desenvolvimento** ganham um chip discreto “em breve” (`--fs-label`, `--text-3`,
   `--surface-2`). Continuam clicáveis — a tela explica o estado.
2. **Modo rail no desktop.** Colapsar reduz para `--sidebar-rail-w` mostrando só os ícones, com
   `title` + `aria-label`. **Nunca `display: none` no desktop.** Overlay/drawer permanece só em
   ≤1024px.
3. **Item ativo:** barra vertical de 2px em `var(--brand)` na borda esquerda + `background:
   var(--surface-2)` + `color: var(--text)`. Sem preenchimento verde no item inteiro.
4. Marca: símbolo `M` real (SVG monocromático, `currentColor`) + wordmark “Move Intelligence”.
   **Sem quadrado com gradiente.** Remover “Trend OS · v2.4”.
5. Rodapé “Sinais ao vivo”: só renderizar com contagem real vinda de `AlertsService`. Sem dado →
   não renderizar. Remover a animação `pulse` infinita (ou aplicar só quando houver atividade e
   respeitando `prefers-reduced-motion`).
6. Extraia os SVGs inline do template para o `IconComponent` — hoje há ~40 linhas de SVG dentro de
   um `@switch` no HTML da sidebar, duplicando o sistema de ícones.

### 5.2 Topbar (`shared/layout/top-bar/`)

Remover tudo que não funciona; entregar o que a interface promete.

| Elemento | Ação |
|---|---|
| “Mercado Aberto” | **Remover** |
| “BRL · Atualizado há 2min · 14h32 BRT” | **Remover** ou substituir por timestamp real da última coleta |
| Busca + `⌘K` | **Implementar** command palette (§5.3) ou **remover ambos** |
| “Ask Move AI” | Navegar para `/ai-copilot` (`routerLink`) — ou remover |
| Sino de notificações | Ligar aos alertas reais com painel; badge só com não lidos > 0. Sem dado → remover |
| Usuário “Rafael Brudden” | Vir do `AuthService`. Sem auth → menu genérico com “Sair” e “Tema” |
| Alternador de tema | Manter, com ícone correto (`sun`/`moon`/`monitor`) e 3 estados |

Estrutura: `[toggle sidebar] [breadcrumb da rota atual] ——— [busca] ——— [ações] [usuário]`.
O breadcrumb resolve o “onde estou” que hoje falta.

Altura `--topbar-h` (56px). `position: sticky` com `backdrop-filter` — este é um dos dois lugares
onde blur é permitido.

### 5.3 Command palette (⌘K) — novo

Já é prometido pela UI; entregue. `shared/ui/command-palette/`, standalone, sem dependência externa.

- Abre com `⌘K` / `Ctrl+K` e pelo clique na busca.
- Navegação: todas as 10 rotas por nome e sinônimo.
- Ações: alternar tema, alternar sidebar, ir para AI Copilot.
- Busca de produtos: consulta `TrendsService`, com debounce de 250ms.
- Acessível: `role="dialog"`, `aria-modal`, foco preso, `Esc` fecha, `↑↓` navegam, `Enter` executa,
  retorno de foco ao elemento de origem.
- Estado vazio: “Nada encontrado para «x»” + lista de ações sugeridas.

### 5.4 Dashboard `/` (`features/dashboard/`)

**Remover integralmente o hero de marketing.** Um usuário logado não precisa da proposta de valor —
precisa do estado do negócio hoje.

Deletar: `.hero`, `.hero-bg-grid`, `.hero-glow-a/b`, `.headline`, `.lead`, `.badge`,
`.text-gradient`, `.ticker` + `@keyframes marquee`, `.cta`.

Nova estrutura, de cima para baixo:

1. **Cabeçalho de contexto** — “Executivo” + linha única com a data da última coleta (real) +
   seletor de janela temporal (reusar `WindowSelectorComponent`).
2. **Faixa de KPIs** — 4 cards no máximo, mesma altura, número dominante em `--fs-display` tabular,
   delta com sinal e cor semântica, sparkline de 40px opcional. Cada card mantém o botão “por quê?”
   (é um bom padrão existente — ver §5.9).
3. **Bloco de decisão (destaque visual máximo)** — “O que exige decisão agora”: lista de 3–5
   produtos que cruzaram limiar, cada linha com produto, score, motivo em uma frase e ação primária
   (“Ver dossiê”). **Este é o único bloco que recebe o verde da marca.** Responde à pergunta
   “qual informação faria o usuário tomar uma decisão diferente?”.
4. **Top sinais** — grade de `app-trend-card` (mantida).
5. **Matriz de risco + fontes de sinal** — mantidos, sem `.glass`.

### 5.5 Ranking `/ranking`

1. **Remover as colunas mortas** “Margem”, “Lead”, “Pipeline” (hoje `—` em 100% das linhas). Voltam
   quando o dado existir.
2. **Ordenação real:** `th` com `aria-sort="ascending|descending|none"`, ícone de direção visível,
   toggle asc/desc, e “Rank” ordenando por posição (não pelo mesmo campo de “Score”).
3. `<th scope="col">` em todos os cabeçalhos.
4. Cabeçalho **sticky** dentro do container de scroll (`position: sticky; top: 0`).
5. **Primeira coluna fixa** (`position: sticky; left: 0`) no scroll horizontal — hoje o usuário
   arrasta e perde o nome do produto.
6. Zebra removida; separação por `border-bottom: 1px solid var(--border)`. Hover: `--surface-2`
   (não tinta verde).
7. Números alinhados à direita; texto à esquerda; nunca centralizado (o CSS atual centraliza 8 de 10
   colunas, o que destrói a comparação vertical de números).
8. **Mobile (<768px):** trocar tabela por lista de cards — produto, score, crescimento, risco, ação.
   Tabela com `min-width: 1040px` não é uma experiência mobile.
9. Estados: loading com skeleton de 5 linhas (não spinner centralizado); vazio com texto + ação;
   filtro sem resultado é **estado diferente** do vazio inicial (“Nenhum produto para «x». Limpar
   filtros”).

### 5.6 Login e Cadastro (`features/auth/`)

1. **Remover as estatísticas inventadas** (12k+, 94%, 48h).
2. Remover `.bg-grid`, `.bg-glow-a/b`, `.bg-orb-1/2`, `.text-gradient`.
3. Nova composição, fiel à marca: **fundo preto sólido**, símbolo `M` verde, wordmark, e uma frase
   curta de posicionamento. Opcionalmente **um** traço angular verde da identidade no canto — o
   elemento gráfico autorizado pelo manual. Sem gradiente, sem orb, sem grid.
4. CTA primário: **fundo `var(--brand)` com texto `var(--brand-ink)` (preto)**. Sem gradiente.
5. Botões OAuth: só manter se Google/Microsoft forem realmente integrados. Caso contrário, remover —
   botão de login social que não loga é a pior promessa quebrada possível.
6. Validação: mensagem por campo, `aria-invalid`, `aria-describedby`, foco no primeiro erro, erro de
   servidor em `role="alert"`.
7. `login.component.css` tem 470 linhas e `cadastro.component.css` 619 — em grande parte reestilizando
   botões e inputs. Após criar as primitivas (§5.9), ambos devem cair para <150 linhas.
8. `/cadastro` usa ícones inexistentes (`nome`, `email`, `empresa`, `password`, `terms`) — corrigir
   junto com §5.8.

### 5.7 Telas “em desenvolvimento” (`/mercados`, `/pipeline`, `/recomendacoes`)

Não deixe o usuário descobrir sozinho. Cada uma exibe um estado explícito:

- Título da tela + chip “Em desenvolvimento”.
- Uma frase do que o módulo vai entregar.
- O que fazer nesse meio-tempo (link para a tela que hoje cobre a necessidade).
- Sem layout falso, sem placeholder cinza imitando conteúdo.

### 5.8 Ícones (`shared/ui/icon/`)

1. **Adicionar os 10 ícones faltantes** (traço 1.5–2px, viewBox 24, `currentColor`, estilo único —
   base Lucide): `search`, `command`, `sparkles`, `flame`, `arrow-up-right`, `email`, `password`,
   `nome` (→ renomear para `user`), `empresa` (→ `building`), `terms` (→ `file-check`).
2. **Renomear nomes em português para inglês** (`nome`, `empresa`, `terms`) — o resto do set é
   inglês; misturar idioma em chave de API interna gera erro.
3. Trocar o `@default` de “círculo com !” por **nada renderizado** + `console.warn` em dev. Ícone
   ausente deve ser invisível, não parecer um alerta.
4. Tipar `name` como união literal em vez de `string`, para o compilador pegar nome inválido.
5. Remover os 10 ícones não utilizados ou mantê-los se houver uso planejado — documente a decisão.
6. Migrar os SVGs inline da sidebar e do login para cá.

### 5.9 Primitivas de UI — criar antes de mexer nas telas

Substituem os 17 estilos de botão e os inputs duplicados. Todos standalone, `OnPush`.

**`shared/ui/button/`** — `<app-button>`
- `variant`: `primary` (fill `--brand`, texto preto) · `secondary` (fill `--surface-2`, borda) ·
  `ghost` (transparente) · `danger`
- `size`: `sm` (28px) · `md` (36px) · `lg` (44px)
- `icon-only` (com `aria-label` obrigatório), `loading` (spinner + `aria-busy`), `disabled`
- Alvo de toque: `md`/`lg` ≥ 44px em `pointer: coarse` via `@media`.

**`shared/ui/field/`** — label + input/select/textarea + hint + erro, com `id`/`for`,
`aria-describedby` e `aria-invalid` ligados automaticamente.

**`shared/ui/segmented/`** — generaliza `window-selector` e os grupos de pill/chip/metric-btn.
`role="radiogroup"`, navegação por setas.

**`shared/ui/data-table/`** — cabeçalho sticky, `aria-sort`, primeira coluna fixa, alinhamento
numérico, estados de loading/vazio/erro, colapso para cards no mobile.

**`shared/ui/skeleton/`** — substitui o spinner genérico do `state-panel` no carregamento de listas
e tabelas.

**`shared/ui/explain/`** — generaliza o excelente botão “por quê?” do `kpi-card`. Popover ancorado
com `role="dialog"`, `Esc` fecha, foco gerenciado. **Aplicar em toda métrica não óbvia:** score
gauge, matriz de risco, histograma Monte Carlo, curva de adoção, tiers de fornecedor. É o principal
mecanismo para o usuário não precisar perguntar como usar a plataforma.

**`shared/ui/empty-state/`** — padroniza os estados vazios com três partes obrigatórias:
o que é · por que está vazio · uma ação.

### 5.10 Estados obrigatórios

`state-panel` já cobre loading/empty/error, mas com spinner genérico e cópia igual para tudo.
Toda feature deve implementar:

| Estado | Requisito |
|---|---|
| Loading | Skeleton com a forma do conteúdo real. Spinner só em ação pontual (<1s). |
| Vazio inicial | Explica o que aparecerá ali e por que ainda não apareceu. |
| Vazio por filtro | Cópia diferente + botão “Limpar filtros”. |
| Erro | Causa em linguagem simples + “Tentar de novo” que refaz a chamada. `role="alert"`. |
| Sucesso | Confirmação visível de ação que muda dados (salvar regras, testar webhook). |
| Parcial | Quando parte dos dados falha, mostrar o que veio e sinalizar o que faltou. |

Hoje `/sinais` tem “Salvar Regras” e “Testar Disparo” cujo retorno é uma string solta em `.status-msg`.
Substituir por toast/inline alert com estado semântico.

### 5.11 ECharts

Os componentes `intel/*` usam ECharts com cores herdadas do tema antigo. Centralize:

1. Crie `shared/charts/echarts-theme.ts` que lê os tokens CSS via
   `getComputedStyle(document.documentElement)` e monta o objeto de tema.
2. Reaja à troca de tema: `effect()` sobre o signal do `ThemeService` → `chart.setOption()`.
3. Série categórica na ordem `--chart-1..6`. Nunca codificar hex dentro do componente.
4. Grid, eixos e tooltip com `--border`, `--text-2`, `--surface`.
5. Tooltip com números tabulares e unidade.
6. `aria-label` no container + tabela de dados acessível (`.sr-only`) para leitor de tela.

---

## 6. Acessibilidade — critérios de aceite

- [ ] `:focus-visible` visível em **todos** os interativos (regra global em `styles.css` + nenhum
      `outline: none` sem substituto).
- [ ] Contraste: texto normal ≥ 4.5:1, texto grande e ícones ≥ 3:1, em **ambos** os temas.
      Validar `--text-2`, `--text-3` e os semânticos sobre `--surface` e `--surface-2`.
- [ ] Nenhum texto abaixo de 12px. Eliminar todos os `0.62rem`/`0.65rem`.
- [ ] Alvos de toque ≥ 44×44px em `pointer: coarse`.
- [ ] `prefers-reduced-motion` respeitado; nenhuma animação infinita sem propósito.
- [ ] Tabelas com `scope`, `aria-sort` e `<caption>` (visualmente oculto quando redundante).
- [ ] Formulários com `<label for>`, `aria-invalid`, `aria-describedby`, foco no primeiro erro.
- [ ] Landmarks: `<header>`, `<nav aria-label>`, `<main>`, `<aside aria-label>`.
- [ ] Skip link “Pular para o conteúdo” como primeiro elemento focável.
- [ ] Modais/popovers: foco preso, `Esc` fecha, foco retorna à origem.
- [ ] Navegação completa por teclado — validar percorrendo cada tela só com Tab/Shift+Tab/setas.
- [ ] Cor nunca é o único portador de informação (risco, delta, status levam ícone ou texto).

---

## 7. Responsividade — critérios de aceite

Breakpoints únicos, declarados como comentário no topo de `styles.css`:
`sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`.

- [ ] **≥1280px:** sidebar expandida + conteúdo, `max-width: var(--content-max)`.
- [ ] **1024–1280px:** sidebar em **rail** (ícones), conteúdo fluido.
- [ ] **768–1024px:** sidebar vira drawer com backdrop; topbar reduz para toggle + título + ações.
- [ ] **<768px:** tabelas viram cards; grids de 2–4 colunas viram 1; KPIs em scroll horizontal com
      snap **ou** grade 2×2; padding do conteúdo cai para `--sp-4`.
- [ ] Nenhum scroll horizontal na página em nenhuma largura (só dentro de containers marcados).
- [ ] Testar em 360, 414, 768, 1024, 1280, 1440, 1920.
- [ ] Área segura em iOS (`env(safe-area-inset-*)`) na barra inferior, se houver.

---

## 8. Regras anti-“visual de IA” — checklist de proibições

Ao final, **nenhum** destes pode existir no código:

- [ ] `background-image` decorativo no `body` ou `html`.
- [ ] Elemento cuja única função é `filter: blur()` para criar “glow”.
- [ ] `background-clip: text` com gradiente (texto em gradiente).
- [ ] Gradiente em botão, logo ou avatar. *(Também viola a regra 6 do brand book.)*
- [ ] `backdrop-filter` fora da topbar fixa e de overlays.
- [ ] `animation: ... infinite` sem propósito funcional.
- [ ] Marquee / ticker.
- [ ] Grid ou pontilhado de fundo puramente decorativo.
- [ ] “Orbs” / círculos borrados posicionados absolutamente.
- [ ] Card dentro de card com borda em ambos.
- [ ] Mais de 3 pesos de fonte na mesma tela.
- [ ] Raio de borda > 10px em card, botão ou input.
- [ ] Emoji como ícone de interface.
- [ ] Sombra colorida (`box-shadow` com matiz da marca).
- [ ] Copy de marketing dentro do app logado.
- [ ] Número inventado exibido como dado real.

---

## 9. Verificação antes de entregar

Execute e reporte o resultado real de cada item — não presuma.

```bash
cd /Users/raul/Desktop/Move-All/Move-Intelligence-Front
npm run build          # deve passar dentro dos budgets do angular.json
npm test               # vitest
npm start              # e navegar por TODAS as rotas
```

Percorra manualmente no navegador:

1. `/` `/ranking` `/comparador` `/sinais` `/ai-copilot` `/sourcing` `/tendencia/<id>`
   `/mercados` `/pipeline` `/recomendacoes` `/login` `/cadastro` `/rota-inexistente`
2. Em cada uma: **console sem erro e sem warning**.
3. Alternar tema claro ↔ escuro em cada tela — nenhum texto ilegível, nenhuma cor hardcoded vazando.
4. Recarregar após trocar o tema — a preferência persiste.
5. Colapsar/expandir a sidebar no desktop — o rail aparece, a navegação nunca some.
6. Percorrer cada tela **só com teclado**.
7. Redimensionar de 360px a 1920px — sem scroll horizontal, sem overflow, sem texto cortado.
8. Com o backend desligado: toda tela mostra estado de erro/vazio útil, nenhuma tela em branco.
9. Conferir a checklist §8 com `grep` no `src/`:

```bash
grep -rn "backdrop-filter\|background-clip: text\|linear-gradient\|infinite\|blur(" src/ | grep -v node_modules
```

---

## 10. Ordem de execução sugerida

| # | Etapa | Entrega |
|---|---|---|
| 1 | Branch + `.gitignore` do PDF | Ambiente isolado |
| 2 | `styles.css` novo + fontes carregadas + `ThemeService` corrigido | Base do design system |
| 3 | `IconComponent` completo e tipado | Fim dos ícones de alerta falsos |
| 4 | Primitivas (§5.9) | Botão, campo, segmented, tabela, skeleton, explain, empty-state |
| 5 | Sidebar + topbar + shell | Navegação completa e “onde estou” resolvido |
| 6 | Dashboard | Painel de decisão no lugar do hero de marketing |
| 7 | Ranking + comparador + sourcing + sinais | Telas de dado sobre as primitivas novas |
| 8 | Tendência + AI Copilot | Telas densas |
| 9 | Login/cadastro + 404 + telas “em breve” | Bordas do produto |
| 10 | Command palette | Cumpre a promessa do `⌘K` |
| 11 | Passe de acessibilidade e responsividade | §6 e §7 |
| 12 | Limpeza de dados fictícios | §3.1 zerado |
| 13 | Verificação §9 + relatório final | Branch pronta para revisão |

---

## 11. Pendências que exigem decisão humana — **pergunte, não invente**

1. **Verde da marca:** usar `#75F852` (amostrado do arquivo, coerente com todas as aplicações) ou
   `#a7f860` (hex escrito no manual)? Divergência real — confirmar com o time de marca.
2. **Termina:** existe licença web? Sem ela, o display fica em Archivo.
3. **Autenticação:** haverá `AuthService` real? Se não, os botões OAuth devem sair.
4. **Nome do produto na UI:** “Move Intelligence” é o nome oficial ou provisório? O manual só cobre
   a marca-mãe Move.
5. **Tema padrão:** escuro fixo, ou seguir o sistema? (Recomendação: seguir o sistema, com escuro
   como escolha inicial em telas de dado.)
6. **Módulos em desenvolvimento:** manter visíveis com chip “em breve” ou ocultar até existirem?
   (Recomendação: visíveis — dá previsibilidade de roadmap ao usuário.)
