import { GEORGIAN_CITIES, type GeorgianCity } from './cities';

/**
 * Cities that appear on the public tariff cards and have defined inter-city rates.
 * Subset of GEORGIAN_CITIES — ხაშური / ვანი are orderable but not in the published matrix.
 */
export const TARIFF_CITIES = [
  'თბილისი',
  'რუსთავი',
  'ბათუმი',
  'ქუთაისი',
  'გორი',
  'თელავი',
] as const;

export type TariffCity = (typeof TARIFF_CITIES)[number];

/** Same-city courier (ქალაქიდან იმავე ქალაქში) — flat rate for every orderable city. */
export const SAME_CITY_DELIVERY_PRICE = 5;

/** Canonical inter-city delivery rates in GEL (ლარი), matching the KA tariff cards. */
export const DELIVERY_TARIFF_MATRIX: Record<TariffCity, Partial<Record<TariffCity, number>>> = {
  თბილისი: {
    რუსთავი: 6,
    თელავი: 7,
    გორი: 6,
    ქუთაისი: 7,
    ბათუმი: 9,
  },
  რუსთავი: {
    თელავი: 6,
    თბილისი: 6,
    გორი: 7,
    ქუთაისი: 8,
    ბათუმი: 10,
  },
  ბათუმი: {
    ქუთაისი: 7,
    გორი: 8,
    თბილისი: 9,
    რუსთავი: 10,
    თელავი: 11,
  },
  ქუთაისი: {
    ბათუმი: 7,
    გორი: 7,
    თბილისი: 7,
    რუსთავი: 9,
    თელავი: 10,
  },
  გორი: {
    ქუთაისი: 7,
    ბათუმი: 9,
    თბილისი: 6,
    რუსთავი: 7,
    თელავი: 8,
  },
  თელავი: {
    რუსთავი: 6,
    თბილისი: 7,
    გორი: 8,
    ქუთაისი: 9,
    ბათუმი: 11,
  },
};

/** Destination display order on each tariff card (preserves existing UI order). */
export const TARIFF_CARD_DESTINATION_ORDER: Record<TariffCity, readonly TariffCity[]> = {
  თბილისი: ['რუსთავი', 'თელავი', 'გორი', 'ქუთაისი', 'ბათუმი'],
  რუსთავი: ['თელავი', 'თბილისი', 'გორი', 'ქუთაისი', 'ბათუმი'],
  ბათუმი: ['ქუთაისი', 'გორი', 'თბილისი', 'რუსთავი', 'თელავი'],
  ქუთაისი: ['ბათუმი', 'გორი', 'თბილისი', 'რუსთავი', 'თელავი'],
  გორი: ['ქუთაისი', 'ბათუმი', 'თბილისი', 'რუსთავი', 'თელავი'],
  თელავი: ['რუსთავი', 'თბილისი', 'გორი', 'ქუთაისი', 'ბათუმი'],
};

export const TARIFF_CARD_META: Record<
  TariffCity,
  {
    headingKey: string;
    fromKa: string;
    toKa: string;
    enName: string;
    imageWebp: string;
    imageJpg: string;
    imageAlt: string;
  }
> = {
  თბილისი: {
    headingKey: 'rate.fromTbilisi',
    fromKa: 'თბილისიდან',
    toKa: 'თბილისში',
    enName: 'Tbilisi',
    imageWebp: '/assets/main/pricing/tbilisi.webp',
    imageJpg: '/assets/main/pricing/tbilisi.jpg',
    imageAlt: 'Tbilisi',
  },
  რუსთავი: {
    headingKey: 'rate.fromRustavi',
    fromKa: 'რუსთავიდან',
    toKa: 'რუსთავში',
    enName: 'Rustavi',
    imageWebp: '/assets/main/pricing/rustavi.webp',
    imageJpg: '/assets/main/pricing/rustavi.jpg',
    imageAlt: 'Rustavi',
  },
  ბათუმი: {
    headingKey: 'rate.fromBatumi',
    fromKa: 'ბათუმიდან',
    toKa: 'ბათუმში',
    enName: 'Batumi',
    imageWebp: '/assets/main/pricing/Batumi-city.webp',
    imageJpg: '/assets/main/pricing/Batumi-city.jpg',
    imageAlt: 'Batumi',
  },
  ქუთაისი: {
    headingKey: 'rate.fromKutaisi',
    fromKa: 'ქუთაისიდან',
    toKa: 'ქუთაისში',
    enName: 'Kutaisi',
    imageWebp: '/assets/main/pricing/Kutaisi-1.webp',
    imageJpg: '/assets/main/pricing/Kutaisi-1.jpg',
    imageAlt: 'Kutaisi',
  },
  გორი: {
    headingKey: 'rate.fromGori',
    fromKa: 'გორიდან',
    toKa: 'გორში',
    enName: 'Gori',
    imageWebp: '/assets/main/pricing/gori.webp',
    imageJpg: '/assets/main/pricing/gori.jpg',
    imageAlt: 'Gori',
  },
  თელავი: {
    headingKey: 'rate.fromTelavi',
    fromKa: 'თელავიდან',
    toKa: 'თელავში',
    enName: 'Telavi',
    imageWebp: '/assets/main/pricing/telavi.webp',
    imageJpg: '/assets/main/pricing/telavi.jpg',
    imageAlt: 'Telavi',
  },
};

export type DeliveryPriceStatus = 'ok' | 'incomplete' | 'unsupported';

export interface DeliveryPriceResult {
  status: DeliveryPriceStatus;
  unitPrice: number | null;
  totalPrice: number | null;
  parcelCount: number;
  origin: string | null;
  destination: string | null;
}

export function isTariffCity(city: string): city is TariffCity {
  return (TARIFF_CITIES as readonly string[]).includes(city);
}

function isOrderableCity(city: string): city is GeorgianCity {
  return (GEORGIAN_CITIES as readonly string[]).includes(city);
}

/** Unit price for a single parcel on a published route, or null if unsupported. */
export function getUnitDeliveryPrice(
  originCity: string,
  destinationCity: string,
): number | null {
  // Intra-city courier: same origin & destination → flat 5 GEL (any orderable city).
  if (originCity === destinationCity && isOrderableCity(originCity)) {
    return SAME_CITY_DELIVERY_PRICE;
  }

  if (!isTariffCity(originCity) || !isTariffCity(destinationCity)) {
    return null;
  }
  const price = DELIVERY_TARIFF_MATRIX[originCity][destinationCity];
  return typeof price === 'number' ? price : null;
}

/**
 * Calculates delivery price from the shared tariff matrix.
 * Published rates are per parcel/shipment; total = unit × parcelCount.
 * Same-city courier is 5 GEL. Inter-city routes outside the matrix
 * (e.g. ხაშური → თელავი) are unsupported.
 */
export function calculateDeliveryPrice(
  originCity: string | null | undefined,
  destinationCity: string | null | undefined,
  parcelCount = 1,
): DeliveryPriceResult {
  const count = Math.max(1, Math.floor(Number(parcelCount) || 1));
  const origin = originCity?.trim() || null;
  const destination = destinationCity?.trim() || null;

  if (!origin || !destination) {
    return {
      status: 'incomplete',
      unitPrice: null,
      totalPrice: null,
      parcelCount: count,
      origin,
      destination,
    };
  }

  const unitPrice = getUnitDeliveryPrice(origin, destination);
  if (unitPrice === null) {
    return {
      status: 'unsupported',
      unitPrice: null,
      totalPrice: null,
      parcelCount: count,
      origin,
      destination,
    };
  }

  return {
    status: 'ok',
    unitPrice,
    totalPrice: unitPrice * count,
    parcelCount: count,
    origin,
    destination,
  };
}

export function formatTariffRouteLine(
  from: TariffCity,
  to: TariffCity,
  price: number,
  language: 'ka' | 'en',
): string {
  const fromMeta = TARIFF_CARD_META[from];
  const toMeta = TARIFF_CARD_META[to];
  if (language === 'ka') {
    return `${fromMeta.fromKa} ${toMeta.toKa} - ${price} ლარი`;
  }
  return `from ${fromMeta.enName} to ${toMeta.enName} - ${price} GEL`;
}

/** All cities offered in order forms / calculator selectors. */
export const CALCULATOR_CITIES: readonly GeorgianCity[] = GEORGIAN_CITIES;
