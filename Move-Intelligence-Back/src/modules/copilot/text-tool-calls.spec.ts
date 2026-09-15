import { extractTextToolCalls, stripTextToolCalls } from './text-tool-calls';

describe('text-tool-calls (P0-3)', () => {
  it('reconhece o texto exato do print (exec + SQL) e limpa o texto', () => {
    const content =
      '<tool_call>exec <argkey>query</argkey> <argvalue>SELECT column_name FROM information_schema.columns</arg_value> </tool_call>';
    const { calls, cleanText } = extractTextToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('exec');
    expect(calls[0].args).toEqual({ query: 'SELECT column_name FROM information_schema.columns' });
    expect(cleanText).toBe('');
  });

  it('reconhece variantes de tag (arg_value/arg_key, maiúsculas, multiline)', () => {
    const content = `<TOOL_CALL>get_product_ranking
<arg_key>limit</arg_key>
<arg_value>10</arg_value>
</TOOL_CALL>`;
    const { calls, cleanText } = extractTextToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('get_product_ranking');
    expect(calls[0].args).toEqual({ limit: 10 });
    expect(cleanText).toBe('');
  });

  it('reconhece JSON dentro do bloco', () => {
    const { calls } = extractTextToolCalls(
      '<tool_call>{"name": "search_products", "arguments": {"query": "halter"}}</tool_call>',
    );
    expect(calls).toEqual([{ name: 'search_products', args: { query: 'halter' } }]);
  });

  it('mantém o texto fora dos blocos e extrai vários', () => {
    const { calls, cleanText } = extractTextToolCalls(
      'Olá <tool_call>exec</tool_call> mundo <tool_call>get_product_ranking</tool_call> fim',
    );
    expect(calls.map((c) => c.name)).toEqual(['exec', 'get_product_ranking']);
    expect(cleanText).toBe('Olá  mundo  fim');
  });

  it('sem blocos devolve texto intacto e zero chamadas', () => {
    expect(extractTextToolCalls('Resposta normal.')).toEqual({ calls: [], cleanText: 'Resposta normal.' });
    expect(extractTextToolCalls(null)).toEqual({ calls: [], cleanText: '' });
  });

  it('strip remove blocos inclusive sem fechamento', () => {
    expect(stripTextToolCalls('abc <tool_call>exec resto')).toBe('abc');
    expect(stripTextToolCalls(null)).toBe('');
  });
});
