function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
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

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      closeList();
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
