import { buildReviewSentimentSeries, starCounts } from './review-sentiment';

const monday = (day: number) => new Date(Date.UTC(2026, 7, day, 12)); // agosto/2026: 3, 10, 17 são segundas

describe('buildReviewSentimentSeries', () => {
  it('soma novas avaliações por faixa e pondera a nota média pelo total', () => {
    const observations = [
      { listingId: 'a', observedAt: monday(3), rating: 4.5, reviewsCount: 100, distribution: { '1': 5, '2': 5, '3': 10, '4': 30, '5': 50 } },
      { listingId: 'a', observedAt: monday(10), rating: 4.4, reviewsCount: 110, distribution: { '1': 7, '2': 5, '3': 11, '4': 32, '5': 55 } },
      { listingId: 'b', observedAt: monday(3), rating: 4.0, reviewsCount: 50, distribution: { '1': 5, '2': 5, '3': 5, '4': 15, '5': 20 } },
      { listingId: 'b', observedAt: monday(10), rating: 4.0, reviewsCount: 60, distribution: { '1': 5, '2': 5, '3': 5, '4': 20, '5': 25 } },
    ];

    const { points, totals } = buildReviewSentimentSeries(observations, Number.MAX_SAFE_INTEGER);

    expect(points).toHaveLength(2);
    expect(points[0]).toEqual(expect.objectContaining({ positive: 0, negative: 0, neutral: 0 })); // semana base
    expect(points[1]).toEqual(expect.objectContaining({ positive: 17, neutral: 1, negative: 2 }));
    expect(points[1].avg_rating).toBe(4.26); // (4,4×110 + 4,0×60) / 170 = 4,2588
    expect(totals).toEqual(expect.objectContaining({ positive: 17, negative: 2, positive_share: 85 }));
  });

  it('respeita a janela e ignora observações sem distribuição', () => {
    const observations = [
      { listingId: 'a', observedAt: monday(3), rating: 4, reviewsCount: 10, distribution: null },
      { listingId: 'a', observedAt: monday(17), rating: 4, reviewsCount: 12, distribution: { '5': 12 } },
    ];
    const { points } = buildReviewSentimentSeries(observations, 7 * 86_400_000);
    expect(points).toHaveLength(1);
    expect(points[0].positive).toBe(0);
  });

  it('converte distribuição em percentual para contagem', () => {
    expect(starCounts({ '1': 10, '2': 0, '3': 10, '4': 30, '5': 50 }, 1000)).toEqual([100, 0, 100, 300, 500]);
    expect(starCounts({}, 10)).toBeNull();
  });
});
