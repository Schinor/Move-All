import { autoAssignConfig } from './catalog.constants';
import { Candidate, decideMissingSpec } from './auto-assign';

const cfg = (overrides: Partial<ReturnType<typeof autoAssignConfig>> = {}) => ({
  enabled: true,
  minSimilarity: 0.35,
  minMargin: 0.10,
  diffMinListings: 3,
  diffMinMarketplaces: 2,
  maxRequeues: 2,
  ...overrides,
});

const candidate = (clusterId: string, similarity: number, countedItems = 1): Candidate => ({
  clusterId,
  similarity,
  countedItems,
});

describe('decideMissingSpec', () => {
  it('manda para revisão quando não há candidato', () => {
    expect(decideMissingSpec([], cfg())).toEqual({ kind: 'review', reason: 'falta a especificação' });
  });

  it('atribui o único candidato que já tem item contado', () => {
    expect(decideMissingSpec([candidate('card-1', 0.01)], cfg())).toEqual({
      kind: 'assign', clusterId: 'card-1', rule: 'single_candidate',
    });
  });

  it('manda o único candidato sem item contado para revisão', () => {
    expect(decideMissingSpec([candidate('card-1', 0.99, 0)], cfg())).toEqual({
      kind: 'review', reason: 'falta a especificação',
    });
  });

  it('atribui o vencedor quando similaridade e margem atingem os limites', () => {
    expect(decideMissingSpec([
      candidate('card-best', 0.50), candidate('card-second', 0.40), candidate('card-third', 0.20),
    ], cfg())).toEqual({ kind: 'assign', clusterId: 'card-best', rule: 'best_similarity' });
  });

  it('manda empate para revisão quando a margem fica abaixo do limite', () => {
    expect(decideMissingSpec([candidate('card-a', 0.50), candidate('card-b', 0.41)], cfg())).toEqual({
      kind: 'review', reason: 'empate entre cards: card-a, card-b',
    });
  });

  it('desabilitado sempre manda para revisão', () => {
    expect(decideMissingSpec([candidate('card-1', 1)], cfg({ enabled: false }))).toEqual({
      kind: 'review', reason: 'falta a especificação',
    });
  });
});

describe('autoAssignConfig', () => {
  it('usa os padrões da Tarefa 3', () => {
    expect(autoAssignConfig({})).toEqual({
      enabled: true,
      minSimilarity: 0.35,
      minMargin: 0.10,
      diffMinListings: 3,
      diffMinMarketplaces: 2,
      maxRequeues: 2,
    });
  });

  it('lê e limita os valores do ambiente', () => {
    expect(autoAssignConfig({
      CATALOG_AUTO_ASSIGN_ENABLED: 'false',
      CATALOG_AUTO_MIN_SIMILARITY: '0.8',
      CATALOG_AUTO_MIN_MARGIN: '0.2',
      CATALOG_AUTO_DIFF_MIN_LISTINGS: '4.8',
      CATALOG_AUTO_DIFF_MIN_MARKETPLACES: '3',
      CATALOG_AUTO_MAX_REQUEUES: '-4',
    })).toEqual({
      enabled: false,
      minSimilarity: 0.8,
      minMargin: 0.2,
      diffMinListings: 4,
      diffMinMarketplaces: 3,
      maxRequeues: 0,
    });
  });
});
