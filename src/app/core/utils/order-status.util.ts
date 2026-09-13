import {
  Order,
  OrderStatus,
  PaymentMethod,
  CourierDailySummary,
} from '../models/order.model';
import { UserRole } from '../models/profile.model';

export function orderStatusLabelKey(status: OrderStatus | string | null | undefined): string {
  if (!status) {
    return 'orders.status.pending';
  }
  return `orders.status.${status}`;
}

export function orderStatusClass(status: OrderStatus | string | null | undefined): string {
  const safe = status || 'pending';
  return `status-badge status-badge--${safe}`;
}

export function parseRole(role: string | null | undefined): UserRole {
  if (role === 'admin' || role === 'courier') {
    return role;
  }
  return 'user';
}

/** Format GEL amount safely for display (2 decimals). */
export function formatGel(amount: number | string | null | undefined): string {
  const cents = toCents(amount);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Convert decimal amount to integer tetri/cents. */
export function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') {
    return 0;
  }
  const normalized = String(amount).replace(',', '.').trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/);
  if (!match) {
    const n = Number(normalized);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2] || '0');
  const frac = (match[3] || '').padEnd(2, '0').slice(0, 2);
  return sign * (whole * 100 + Number(frac));
}

export function centsToNumber(cents: number): number {
  return cents / 100;
}

export function parsePaymentMethod(value: unknown): PaymentMethod | null {
  return value === 'cash' || value === 'card' ? value : null;
}

export function normalizeOrder(
  raw: (Partial<Order> & { id?: number | string }) | null | undefined,
): Order | null {
  if (!raw) {
    return null;
  }

  return {
    id: Number(raw.id),
    user_id: String(raw.user_id ?? ''),
    assigned_courier_id: raw.assigned_courier_id ? String(raw.assigned_courier_id) : null,
    sender_name: raw.sender_name ?? '',
    sender_phone: raw.sender_phone ?? '',
    pickup_city: raw.pickup_city ?? '',
    pickup_district: raw.pickup_district ?? '',
    pickup_address: raw.pickup_address ?? '',
    recipient_name: raw.recipient_name ?? '',
    recipient_phone: raw.recipient_phone ?? '',
    delivery_city: raw.delivery_city ?? '',
    delivery_district: raw.delivery_district ?? '',
    delivery_address: raw.delivery_address ?? '',
    parcel_count: Number(raw.parcel_count ?? 0),
    delivery_date: raw.delivery_date ?? '',
    notes: raw.notes ?? null,
    status: (raw.status as OrderStatus) ?? 'pending',
    payment_method: parsePaymentMethod(raw.payment_method),
    collected_amount: centsToNumber(toCents(raw.collected_amount as number | string | null)),
    delivered_at: raw.delivered_at ?? null,
    created_at: raw.created_at ?? '',
    updated_at: raw.updated_at ?? '',
  };
}

export function normalizeOrders(rows: unknown[] | null | undefined): Order[] {
  if (!rows?.length) {
    return [];
  }
  return rows
    .map((row) => normalizeOrder(row as Partial<Order> & { id?: number | string }))
    .filter((order): order is Order => order !== null);
}

export function buildMapsUrl(order: Pick<Order, 'delivery_city' | 'delivery_district' | 'delivery_address'>): string {
  const query = [order.delivery_address, order.delivery_district, order.delivery_city]
    .filter((part) => Boolean(part?.trim()))
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildTelHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned) {
    return 'tel:';
  }
  if (cleaned.startsWith('+')) {
    return `tel:${cleaned}`;
  }
  if (cleaned.startsWith('995')) {
    return `tel:+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    return `tel:+995${cleaned.slice(1)}`;
  }
  return `tel:+995${cleaned}`;
}

export function summarizeCourierDay(orders: Order[]): CourierDailySummary {
  let cashCents = 0;
  let cardCents = 0;
  let deliveredCount = 0;

  for (const order of orders) {
    deliveredCount += 1;
    const cents = toCents(order.collected_amount);
    if (order.payment_method === 'cash') {
      cashCents += cents;
    } else if (order.payment_method === 'card') {
      cardCents += cents;
    }
  }

  return {
    cashTotal: formatGel(centsToNumber(cashCents)),
    cardTotal: formatGel(centsToNumber(cardCents)),
    grandTotal: formatGel(centsToNumber(cashCents + cardCents)),
    deliveredCount,
  };
}
