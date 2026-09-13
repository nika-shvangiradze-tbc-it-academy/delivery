import { Order, OrderStatus } from '../models/order.model';

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

export function normalizeOrder(raw: Partial<Order> & { id?: number | string }): Order {
  return {
    id: Number(raw.id),
    user_id: String(raw.user_id ?? ''),
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
    created_at: raw.created_at ?? '',
  };
}

export function normalizeOrders(rows: unknown[] | null | undefined): Order[] {
  if (!rows?.length) {
    return [];
  }
  return rows.map((row) => normalizeOrder(row as Partial<Order> & { id?: number | string }));
}
