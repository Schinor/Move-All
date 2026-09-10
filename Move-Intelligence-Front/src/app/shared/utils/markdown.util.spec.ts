import { renderCopilotMarkdown } from './markdown.util';

describe('renderCopilotMarkdown', () => {
  it('renderiza negrito, titulo e listas sem exibir os marcadores Markdown', () => {
    const result = renderCopilotMarkdown(
      '**Ainda não há dados disponíveis.**\n\n## O que isso significa\n\n- Primeiro ponto\n- Segundo ponto',
    );

    expect(result).toContain('<strong>Ainda não há dados disponíveis.</strong>');
    expect(result).toContain('<h2>O que isso significa</h2>');
    expect(result).toContain('<ul><li>Primeiro ponto</li><li>Segundo ponto</li></ul>');
    expect(result).not.toContain('**');
    expect(result).not.toContain('##');
  });

  it('escapa HTML recebido na resposta antes de formatar Markdown', () => {
    const result = renderCopilotMarkdown('<script>alert(1)</script> **seguro**');

    expect(result).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).toContain('<strong>seguro</strong>');
    expect(result).not.toContain('<script>');
  });

  it('renderiza tabela Markdown como <table> em vez de texto com pipes', () => {
    const result = renderCopilotMarkdown(
      '| Produto | Score |\n|---|---|\n| Kit Super Bands | 65 |\n| Kettlebell 16kg | 52 |',
    );

    expect(result).toContain('<table>');
    expect(result).toContain('<th>Produto</th>');
    expect(result).toContain('<th>Score</th>');
    expect(result).toContain('<td>Kit Super Bands</td>');
    expect(result).toContain('<td>65</td>');
    expect(result).not.toContain('|---|');
    expect(result).not.toContain('<p>| Produto');
  });

  it('aplica formatacao inline dentro das celulas da tabela', () => {
    const result = renderCopilotMarkdown('| Produto |\n| --- |\n| **Kit Super Bands** |');

    expect(result).toContain('<td><strong>Kit Super Bands</strong></td>');
    expect(result).not.toContain('**');
  });

  it('escapa HTML dentro das celulas da tabela', () => {
    const result = renderCopilotMarkdown('| Coluna |\n| --- |\n| <img src=x onerror=y> |');

    expect(result).toContain('&lt;img src=x onerror=y&gt;');
    expect(result).not.toContain('<img');
  });

  it('trata linha isolada com pipe como paragrafo comum', () => {
    const result = renderCopilotMarkdown('Use o filtro A | B para comparar');

    expect(result).toContain('<p>Use o filtro A | B para comparar</p>');
    expect(result).not.toContain('<table>');
  });

  it('preserva underscores de identificadores dentro de code spans', () => {
    const result = renderCopilotMarkdown('A flag `monte_carlo_simulated` está como `true`.');

    expect(result).toContain('<code>monte_carlo_simulated</code>');
    expect(result).not.toContain('<em>');
  });

  it('nao aplica negrito ou italico dentro de code spans', () => {
    const result = renderCopilotMarkdown('Use `**nao_negrito**` literalmente');

    expect(result).toContain('<code>**nao_negrito**</code>');
    expect(result).not.toContain('<strong>');
  });
});
