import {
  WEIGHT_TARIFF_BANDS,
  calculateWeightPrice,
  getWeightTariff,
} from './weight-tariffs';

describe('weight-tariffs', () => {
  it('exposes seven published bands matching the public table', () => {
    expect(WEIGHT_TARIFF_BANDS.map((b) => b.price)).toEqual([5, 7, 9, 11, 14, 16, 20]);
  });

  it('classifies interior and boundary weights without overlap', () => {
    const cases: Array<[number, number]> = [
      [0.5, 5],
      [1, 5],
      [4.9, 5],
      [5, 5],
      [5.1, 7],
      [9.9, 7],
      [10, 7],
      [10.1, 9],
      [15, 9],
      [20, 11],
      [30, 14],
      [40, 16],
      [49.9, 20],
      [50, 20],
    ];

    for (const [weight, price] of cases) {
      expect(getWeightTariff(weight)?.price, `${weight} kg`).toBe(price);
    }
  });

  it('rejects empty, invalid, and over-limit weights', () => {
    expect(calculateWeightPrice(null).status).toBe('empty');
    expect(calculateWeightPrice(NaN).status).toBe('empty');
    expect(calculateWeightPrice(0).status).toBe('invalid');
    expect(calculateWeightPrice(-1).status).toBe('invalid');
    expect(calculateWeightPrice(50.1).status).toBe('over_limit');
    expect(getWeightTariff(50.1)).toBeNull();
  });
});
