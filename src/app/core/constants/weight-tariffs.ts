/**
 * Canonical weight-based delivery tariffs (GEL per shipment).
 * Shared by the public weight tariff table and the weight price calculator.
 *
 * Boundary rule (no overlaps):
 * - First band: 0 < weight ≤ 5
 * - Next bands: previousMax < weight ≤ maxInclusive
 * - Exactly 5 / 10 / 15 / 20 / 30 / 40 / 50 → upper edge of that band
 * - weight > 50 → no published tariff (contact)
 */

export interface WeightTariffBand {
  /** Exclusive lower bound (kg). */
  readonly minExclusive: number;
  /** Inclusive upper bound (kg). */
  readonly maxInclusive: number;
  /** Price in GEL for a single shipment in this band. */
  readonly price: number;
  /** i18n key for the full range label (e.g. size.range1). */
  readonly labelKey: string;
  /** Compact segment label for the progress visualization. */
  readonly segmentLabel: string;
}

export const WEIGHT_TARIFF_BANDS: readonly WeightTariffBand[] = [
  { minExclusive: 0, maxInclusive: 5, price: 5, labelKey: 'size.range1', segmentLabel: '0–5' },
  { minExclusive: 5, maxInclusive: 10, price: 7, labelKey: 'size.range2', segmentLabel: '5–10' },
  { minExclusive: 10, maxInclusive: 15, price: 9, labelKey: 'size.range3', segmentLabel: '10–15' },
  { minExclusive: 15, maxInclusive: 20, price: 11, labelKey: 'size.range4', segmentLabel: '15–20' },
  { minExclusive: 20, maxInclusive: 30, price: 14, labelKey: 'size.range5', segmentLabel: '20–30' },
  { minExclusive: 30, maxInclusive: 40, price: 16, labelKey: 'size.range6', segmentLabel: '30–40' },
  { minExclusive: 40, maxInclusive: 50, price: 20, labelKey: 'size.range7', segmentLabel: '40–50' },
] as const;

/** Maximum weight covered by published tariffs (kg). */
export const WEIGHT_TARIFF_MAX_KG = 50;

/** Suggested quick-select weights for the calculator UI. */
export const WEIGHT_QUICK_VALUES = [1, 5, 10, 20, 30, 50] as const;

export type WeightPriceStatus = 'empty' | 'invalid' | 'ok' | 'over_limit';

export interface WeightPriceResult {
  status: WeightPriceStatus;
  weight: number | null;
  price: number | null;
  band: WeightTariffBand | null;
}

/**
 * Resolves the published weight tariff for a parcel weight in kg.
 * Returns null when weight is not a positive finite number ≤ 50.
 */
export function getWeightTariff(weight: number): WeightTariffBand | null {
  if (!Number.isFinite(weight) || weight <= 0 || weight > WEIGHT_TARIFF_MAX_KG) {
    return null;
  }

  for (const band of WEIGHT_TARIFF_BANDS) {
    if (weight > band.minExclusive && weight <= band.maxInclusive) {
      return band;
    }
  }

  return null;
}

/** Live calculator quote from a numeric weight (or null / NaN for empty). */
export function calculateWeightPrice(weight: number | null | undefined): WeightPriceResult {
  if (weight === null || weight === undefined || Number.isNaN(weight)) {
    return { status: 'empty', weight: null, price: null, band: null };
  }

  if (!Number.isFinite(weight) || weight <= 0) {
    return { status: 'invalid', weight, price: null, band: null };
  }

  if (weight > WEIGHT_TARIFF_MAX_KG) {
    return { status: 'over_limit', weight, price: null, band: null };
  }

  const band = getWeightTariff(weight);
  if (!band) {
    return { status: 'invalid', weight, price: null, band: null };
  }

  return {
    status: 'ok',
    weight,
    price: band.price,
    band,
  };
}

/** Formats a tariff price like the public table (e.g. 5.00). */
export function formatWeightPrice(price: number): string {
  return price.toFixed(2);
}

/** Span of a band in kg (for proportional segment widths). */
export function weightBandSpan(band: WeightTariffBand): number {
  return band.maxInclusive - band.minExclusive;
}
