function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Um code span é literal: `monte_carlo_simulated` não pode virar
 * `monte<em>carlo</em>simulated`. Por isso os trechos entre crases saem da
 * string antes das demais regras e voltam já formatados no fim.
 */
function formatInlineMarkdown(value: string): string {
  const codeSpans: string[] = [];
  const withPlaceholders = value.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  const formatted = withPlaceholders
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');

  return formatted.replace(
    /\u0000CODE(\d+)\u0000/g,
    (_match, index: string) => `<code>${codeSpans[Number(index)]}</code>`,
  );
}

/** Divide a linha da tabela em células, ignorando os pipes das bordas. */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Linha separadora do GFM: `|---|:---:|` logo abaixo do cabeçalho. */
function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return splitTableRow(trimmed).every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** Uma tabela precisa do cabeçalho com pipe seguido da linha separadora. */
function isTableStart(line: string, nextLine: string | undefined): boolean {
  return (
    line.trim().includes('|') && nextLine !== undefined && isTableDelimiter(nextLine)
  );
}

function renderTableCells(cells: string[], tag: 'th' | 'td'): string {
  return cells
    .map((cell) => `<${tag}>${formatInlineMarkdown(escapeHtml(cell))}</${tag}>`)
    .join('');
}

/**
 * Renderiza o Markdown básico que o Copilot usa, mantendo o conteúdo seguro.
 * O texto é escapado antes de receber apenas as tags geradas abaixo.
 */
export function renderCopilotMarkdown(markdown: string): string {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let paragraphLines: string[] = [];

  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`);
      listTag = null;
    }
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    html.push(`<p>${paragraphLines.join('<br>')}</p>`);
    paragraphLines = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      flushParagraph();
      closeList();

      const headerCells = splitTableRow(line);
      const columnCount = headerCells.length;
      const bodyRows: string[] = [];
      index += 2; // consome cabeçalho e separador

      while (index < lines.length && lines[index].trim().includes('|')) {
        const cells = splitTableRow(lines[index]);
        // Normaliza para o número de colunas do cabeçalho: sobras viram célula extra vazia.
        while (cells.length < columnCount) cells.push('');
        bodyRows.push(`<tr>${renderTableCells(cells.slice(0, columnCount), 'td')}</tr>`);
        index++;
      }
      index--; // o for externo avança para a próxima linha não consumida

      html.push(
        '<div class="table-scroll">' +
          `<table><thead><tr>${renderTableCells(headerCells, 'th')}</tr></thead>` +
          (bodyRows.length ? `<tbody>${bodyRows.join('')}</tbody>` : '') +
          '</table></div>',
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const unorderedItem = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
    const orderedItem = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
    const item = unorderedItem ?? orderedItem;

    if (item) {
      flushParagraph();
      const nextListTag = unorderedItem ? 'ul' : 'ol';
      if (listTag !== nextListTag) {
        closeList();
        listTag = nextListTag;
        html.push(`<${listTag}>`);
      }
      html.push(`<li>${formatInlineMarkdown(escapeHtml(item[1]))}</li>`);
      continue;
    }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${formatInlineMarkdown(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    closeList();
    paragraphLines.push(formatInlineMarkdown(escapeHtml(line.trim())));
  }

  flushParagraph();
  closeList();
  return html.join('');
}
