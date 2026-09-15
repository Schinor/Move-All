import {
  JsonExtractionError,
  extractJsonObject,
  fallbackRationale,
  isQuadrantAction,
  isRawRationale,
  normalizeAction,
  parseRecommendationPayload,
} from './ai-recommendation-json';

describe('ai-recommendation-json (P0-2)', () => {
  it('extrai JSON com cerca de abertura e fechamento', () => {
    const parsed = extractJsonObject('```json\n{"action":"DECIDIR_AGORA"}\n```') as { action: string };
    expect(parsed.action).toBe('DECIDIR_AGORA');
  });

  it('extrai JSON sem cerca e com texto antes/depois', () => {
    const parsed = extractJsonObject('Análise: {"action":"IGNORAR","rationale":"Ruim."} fim.') as {
      action: string;
    };
    expect(parsed.action).toBe('IGNORAR');
  });

  it('resposta truncada com cerca (caso do print) → no_json_found', () => {
    const truncated =
      '```json\n{ "decision": "AVANCAR_COM_RESSALVAS", "rationale": "O produto apresenta bom potencial de merc';
    expect(() => extractJsonObject(truncated)).toThrow(JsonExtractionError);
    try {
      extractJsonObject(truncated);
    } catch (error) {
      expect((error as JsonExtractionError).reason).toBe('no_json_found');
    }
  });

  it('texto sem JSON → no_json_found; JSON inválido → invalid_json', () => {
    expect(() => extractJsonObject('só texto, sem chaves')).toThrow('no_json_found');
    expect(() => extractJsonObject('{"action":}')).toThrow('invalid_json');
    expect(() => extractJsonObject('   ')).toThrow('empty');
  });

  it('valida ação das 5 e rejeita rationale cru', () => {
    expect(
      parseRecommendationPayload({ action: 'DECIDIR_AGORA', rationale: 'Bom.', key_drivers: ['a', 1] }),
    ).toEqual({ action: 'DECIDIR_AGORA', rationale: 'Bom.', key_drivers: ['a'], recommended_next_step: null });
    expect(parseRecommendationPayload({ action: 'AVANCAR', rationale: '```json {}' })).toBeNull();
    expect(parseRecommendationPayload({ action: 'monitorar', rationale: 'Ok.' })?.action).toBe('DADOS_INSUFICIENTES');
    expect(parseRecommendationPayload({ action: 'INVENTADA', rationale: 'Ok.' })?.action).toBeNull();
    expect(parseRecommendationPayload(null)).toBeNull();
  });

  it('helpers de ação e rationale cru', () => {
    expect(isQuadrantAction('IGNORAR')).toBe(true);
    expect(isQuadrantAction('REPROVAR')).toBe(false);
    expect(normalizeAction('AVANCAR_COM_RESSALVAS')).toBe('NEGOCIAR_CUSTO');
    expect(isRawRationale('```json {"a":1}')).toBe(true);
    expect(isRawRationale('{"a":1}')).toBe(true);
    expect(isRawRationale('Texto normal.')).toBe(false);
    expect(isRawRationale(null)).toBe(true);
  });

  it('fallback determinístico usa só score, ação e risco', () => {
    const text = fallbackRationale({ score: 82, scoreBand: 'green', action: 'DECIDIR_AGORA', riskText: 'Risco baixo.' });
    expect(text).toContain('Move Score 82');
    expect(text).toContain('faixa verde');
    expect(text).toContain('Risco baixo.');
    expect(text).not.toContain('{');
    expect(fallbackRationale({ score: null, action: 'DADOS_INSUFICIENTES' })).toContain('Sem histórico');
  });
});
