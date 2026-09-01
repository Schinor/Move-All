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
});
