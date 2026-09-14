import {
  Order,
  OrderStatus,
  PaymentMethod,
  CourierDailySummary,
  CourierStatus,
} from '../models/order.model';
import { UserRole } from '../models/profile.model';

/** Shared status → UI mapping (labels + CSS modifiers). DB values stay unchanged. */
export const ORDER_STATUS_UI = {
  pending: {
    labelKa: 'მოლოდინში',
    badgeClass: 'status-badge status-badge--pending',
    selectClass: 'status-select status-select--pending',
  },
  picked_up: {
    labelKa: 'აღებული',
    badgeClass: 'status-badge status-badge--picked_up',
    selectClass: 'status-select status-select--picked_up',
  },
  delivered: {
    labelKa: 'ჩაბარებული',
    badgeClass: 'status-badge status-badge--delivered',
    selectClass: 'status-select status-select--delivered',
  },
  cancelled: {
    labelKa: 'გაუქმებული',
    badgeClass: 'status-badge status-badge--cancelled',
    selectClass: 'status-select status-select--cancelled',
  },
} as const satisfies Record<
  OrderStatus,
  { labelKa: string; badgeClass: string; selectClass: string }
>;

function resolveStatusKey(
  status: OrderStatus | string | null | undefined,
): OrderStatus {
  return normalizeLegacyStatus(status) ?? 'pending';
}

/** Map legacy accepted/in_transit → picked_up for display + typed models. */
export function normalizeLegacyStatus(
  status: OrderStatus | string | null | undefined,
): OrderStatus | null {
  if (!status) {
    return null;
  }
  if (status === 'accepted' || status === 'in_transit') {
    return 'picked_up';
  }
  if (
    status === 'pending' ||
    status === 'picked_up' ||
    status === 'delivered' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return null;
}

export function orderStatusLabelKey(status: OrderStatus | string | null | undefined): string {
  return `orders.status.${resolveStatusKey(status)}`;
}

/** CSS classes for status badge/pill. Alias: getStatusClass */
export function orderStatusClass(status: OrderStatus | string | null | undefined): string {
  return ORDER_STATUS_UI[resolveStatusKey(status)].badgeClass;
}

export const getStatusClass = orderStatusClass;

/** CSS classes for admin status <select> reflecting current value. */
export function orderStatusSelectClass(
  status: OrderStatus | string | null | undefined,
): string {
  return ORDER_STATUS_UI[resolveStatusKey(status)].selectClass;
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
  // Strip currency symbols / spaces so "100.00 ₾" still parses.
  const normalized = String(amount)
    .replace(/[^\d,.\-]/g, '')
    .replace(',', '.')
    .trim();
  if (!normalized || normalized === '-' || normalized === '.') {
    return 0;
  }
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

export function parseCourierStatus(value: unknown): CourierStatus | null {
  if (
    value === 'pending' ||
    value === 'picked_up' ||
    value === 'delivered' ||
    value === 'cancelled'
  ) {
    return value;
  }
  // Legacy DB values until migration is applied
  if (value === 'accepted' || value === 'in_transit') {
    return 'picked_up';
  }
  return null;
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
    is_fragile: Boolean(raw.is_fragile),
    status: normalizeLegacyStatus(raw.status) ?? 'pending',
    payment_method: parsePaymentMethod(raw.payment_method),
    amount_to_collect: centsToNumber(toCents(raw.amount_to_collect as number | string | null)),
    collected_amount: centsToNumber(toCents(raw.collected_amount as number | string | null)),
    delivered_at: raw.delivered_at ?? null,
    cancelled_at: raw.cancelled_at ?? null,
    cancellation_reason: (() => {
      const reason = raw.cancellation_reason;
      if (reason == null) {
        return null;
      }
      const trimmed = String(reason).trim();
      return trimmed || null;
    })(),
    courier_sort_order:
      raw.courier_sort_order === null || raw.courier_sort_order === undefined
        ? null
        : Number(raw.courier_sort_order),
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

/** Visual phone formatting for courier UI (keeps dialable digits intact via buildTelHref). */
export function formatPhoneDisplay(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) {
    return '';
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('995') && digits.length > 9) {
    digits = digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1);
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return trimmed;
}

export function courierStatusLabel(status: OrderStatus | string): string {
  return ORDER_STATUS_UI[resolveStatusKey(status)].labelKa;
}

export function auditRoleLabelKa(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return 'ადმინი';
    case 'courier':
      return 'კურიერი';
    case 'user':
      return 'მომხმარებელი';
    case 'system':
      return 'სისტემა';
    default:
      return 'უცნობი';
  }
}

/** Format instant in Asia/Tbilisi for admin audit timeline. */
export function formatTbilisiDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Compact Asia/Tbilisi stamp: 14.09.2026 • 18:42 */
export function formatTbilisiDotDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} • ${get('hour')}:${get('minute')}`;
}

export function paymentMethodLabel(method: PaymentMethod | null | undefined): string {
  if (method === 'cash') return 'ქეში';
  if (method === 'card') return 'ბარათი';
  return '—';
}

export function historyCompletedAt(order: Order): string | null {
  if (order.status === 'delivered') {
    return order.delivered_at;
  }
  if (order.status === 'cancelled') {
    return order.cancelled_at ?? order.updated_at;
  }
  return order.updated_at;
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
