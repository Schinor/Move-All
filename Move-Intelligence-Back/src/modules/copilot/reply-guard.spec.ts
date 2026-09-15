import {
  PROMISE_FALLBACK_EMPTY,
  PROMISE_FALLBACK_SUFFIX,
  chunkReply,
  finalizeReply,
  hasUnfulfilledPromise,
  removeTrailingPromise,
} from './reply-guard';

describe('reply-guard', () => {
  it('detecta a promessa do print e variações', () => {
    expect(
      hasUnfulfilledPromise('Sem resultados com esses termos. Vou ampliar a busca para outros equipamentos de pernas.'),
    ).toBe(true);
    expect(hasUnfulfilledPromise('Deixe-me consultar a base de dados novamente.')).toBe(true);
    expect(hasUnfulfilledPromise('Vou fazer uma nova busca por bicicletas')).toBe(true);
    expect(hasUnfulfilledPromise('Encontrei poucos itens. Um momento.')).toBe(true);
  });

  it('não confunde oferta, recomendação ou resposta completa com promessa', () => {
    expect(hasUnfulfilledPromise('Posso buscar outras categorias se quiser.')).toBe(false);
    expect(hasUnfulfilledPromise('Se quiser, vou buscar os fornecedores desse produto.')).toBe(false);
    expect(hasUnfulfilledPromise('Recomendo verificar o fornecedor antes do pedido.')).toBe(false);
    expect(
      hasUnfulfilledPromise('Vou detalhar abaixo:\n\n| Produto | Move Score |\n|---|---|\n| Bike | 72 |'),
    ).toBe(false);
    expect(hasUnfulfilledPromise('')).toBe(false);
  });

  it('finalizeReply troca a promessa por resposta honesta', () => {
    expect(finalizeReply('Vou ampliar a busca para outros equipamentos de pernas.')).toBe(PROMISE_FALLBACK_EMPTY);
    expect(finalizeReply('Sem resultados com esses termos. Vou ampliar a busca.')).toBe(
      `Sem resultados com esses termos.\n\n${PROMISE_FALLBACK_SUFFIX}`,
    );
    expect(finalizeReply('Encontrei a Bike Spinning com Move Score 72.')).toBe(
      'Encontrei a Bike Spinning com Move Score 72.',
    );
    expect(removeTrailingPromise('Nada aqui. Vou ampliar a busca. Um momento.')).toBe('Nada aqui.');
  });

  it('chunkReply preserva o texto', () => {
    const text = 'Encontrei 2 produtos:\n\n| Produto | Move Score |\n|---|---|\n| Bicicleta Spinning | 72 |';
    const chunks = chunkReply(text, 16);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });
});
