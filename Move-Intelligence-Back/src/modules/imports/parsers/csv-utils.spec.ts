import {
  leafCategory,
  parseCsvHeader,
  parseCsvRecords,
  parseIntSafe,
  parseJsonArray,
  parsePrice,
  parseSold,
} from './csv-utils';

describe('parseCsvRecords', () => {
  it('indexa os registros pelo cabeçalho', () => {
    const content = '"a","b"\n"1","2"\n"3","4"';
    expect(parseCsvRecords(content)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('preserva quebras de linha e JSON dentro dos campos', () => {
    const content =
      '"title","category_tree"\n"linha 1\nlinha 2","[{""name"": ""Casa""}]"';
    const rows = parseCsvRecords(content);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('linha 1\nlinha 2');
    expect(leafCategory(rows[0].category_tree)).toBe('Casa');
  });

  it('ignora o BOM e linhas vazias', () => {
    const content = '﻿"a","b"\n\n"1","2"\n';
    expect(parseCsvRecords(content)).toEqual([{ a: '1', b: '2' }]);
  });

  it('tolera linhas com número de colunas divergente', () => {
    const content = '"a","b"\n"1"\n"2","3"';
    expect(parseCsvRecords(content)).toHaveLength(2);
  });
});

describe('parseCsvHeader', () => {
  it('retorna as colunas da primeira linha', () => {
    expect(parseCsvHeader('"url","item_id"\n"x","1"')).toEqual([
      'url',
      'item_id',
    ]);
  });

  it('retorna [] para conteúdo ilegível', () => {
    expect(parseCsvHeader('')).toEqual([]);
  });
});

describe('parsePrice', () => {
  it('remove símbolo de moeda', () => {
    expect(parsePrice('US$ 3.80')).toBe(3.8);
    expect(parsePrice('$1,299.99')).toBe(1299.99);
  });

  it('entende separador decimal por vírgula', () => {
    expect(parsePrice('R$ 1.234,56')).toBe(1234.56);
    expect(parsePrice('3,80')).toBe(3.8);
  });

  it('entende vírgula como milhar', () => {
    expect(parsePrice('47,980')).toBe(47980);
  });

  it('entende múltiplos pontos como milhar', () => {
    expect(parsePrice('1.234.567')).toBe(1234567);
  });

  it('retorna null para valores vazios ou não numéricos', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice('Free shipping')).toBeNull();
  });
});

describe('parseIntSafe', () => {
  it('trunca decimais e tolera separadores', () => {
    expect(parseIntSafe('12.9')).toBe(12);
    expect(parseIntSafe('1,024')).toBe(1024);
  });

  it('retorna null para valores inválidos', () => {
    expect(parseIntSafe('n/a')).toBeNull();
    expect(parseIntSafe('')).toBeNull();
  });
});

describe('parseJsonArray', () => {
  it('lê um array JSON', () => {
    expect(parseJsonArray('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('retorna [] em falha', () => {
    expect(parseJsonArray('{"a":1}')).toEqual([]);
    expect(parseJsonArray('nao é json')).toEqual([]);
    expect(parseJsonArray('')).toEqual([]);
    expect(parseJsonArray(null)).toEqual([]);
  });
});

describe('leafCategory', () => {
  it('extrai o último name da árvore', () => {
    const tree =
      '[{"name":"Home","url":"/h"},{"name":"Kitchen","url":"/k"},{"name":"Mugs","url":"/m"}]';
    expect(leafCategory(tree)).toBe('Mugs');
  });

  it('ignora elementos finais sem name', () => {
    expect(leafCategory('[{"name":"Home"},{"url":"/x"}]')).toBe('Home');
  });

  it('aceita array de strings', () => {
    expect(leafCategory('["Home","Kitchen"]')).toBe('Kitchen');
  });

  it('retorna null em falha', () => {
    expect(leafCategory('[]')).toBeNull();
    expect(leafCategory('quebrado')).toBeNull();
    expect(leafCategory(null)).toBeNull();
  });
});

describe('parseSold', () => {
  it('entende sufixo k', () => {
    expect(parseSold('1.2k')).toBe(1200);
    expect(parseSold('10k+')).toBe(10000);
    expect(parseSold('10K')).toBe(10000);
  });

  it('entende "mil" em pt-BR', () => {
    expect(parseSold('5,3 mil')).toBe(5300);
  });

  it('entende sufixo de milhão', () => {
    expect(parseSold('1.5M')).toBe(1500000);
  });

  it('lê números simples com separador de milhar', () => {
    expect(parseSold('1,234 sold')).toBe(1234);
    expect(parseSold('842')).toBe(842);
  });

  it('retorna null quando não há número', () => {
    expect(parseSold('')).toBeNull();
    expect(parseSold(null)).toBeNull();
    expect(parseSold('sold')).toBeNull();
  });
});
