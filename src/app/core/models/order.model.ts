export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

/** Status values couriers may set (English DB values only — not UI labels). */
export type CourierStatus =
  | 'accepted'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type PaymentMethod = 'cash' | 'card';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'accepted',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
];

/** @deprecated Prefer complete/cancel RPCs; kept for correction UI labels. */
export const COURIER_ALLOWED_STATUSES: CourierStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
];

/** Statuses a courier may restore/correct to from history. */
export const COURIER_CORRECTION_STATUSES: CourierStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
  'delivered',
  'cancelled',
];
export interface Order {
  id: number;
  user_id: string;
  assigned_courier_id: string | null;
  sender_name: string;
  sender_phone: string;
  pickup_city: string;
  pickup_district: string;
  pickup_address: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_city: string;
  delivery_district: string;
  delivery_address: string;
  parcel_count: number;
  delivery_date: string;
  notes: string | null;
  /** Fragile / breakable package — show courier warning when true */
  is_fragile: boolean;
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  /** Expected amount to collect from recipient */
  amount_to_collect: number;
  /** Amount courier actually collected */
  collected_amount: number;
  delivered_at: string | null;
  cancelled_at: string | null;
  /** Persistent manual route order for the assigned courier */
  courier_sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export const COURIER_ACTIVE_STATUSES: OrderStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
];

export const COURIER_HISTORY_STATUSES: OrderStatus[] = ['delivered', 'cancelled'];

/** Admin Orders status tabs — maps to server-side status filters. */
export type AdminStatusGroup = 'pending' | 'active' | 'delivered' | 'cancelled' | 'all';

export const ADMIN_STATUS_GROUPS: AdminStatusGroup[] = [
  'pending',
  'active',
  'delivered',
  'cancelled',
  'all',
];

export const ADMIN_ACTIVE_STATUSES: OrderStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
];

export type AdminDatePreset = 'all' | 'today' | 'tomorrow' | 'custom';

export const ADMIN_ORDER_PAGE_SIZES = [50, 100] as const;
export type AdminOrderPageSize = (typeof ADMIN_ORDER_PAGE_SIZES)[number];

/**
 * Sentinel for "unassigned" courier filter.
 * Empty / undefined = all couriers; uuid = specific courier.
 */
export const ADMIN_COURIER_UNASSIGNED = 'unassigned' as const;

export interface AdminOrderFilters {
  statusGroup: AdminStatusGroup;
  /** Optional delivery_date filter. Null/empty = all dates. */
  date?: string | null;
  pickupCity?: string | null;
  city?: string | null;
  /**
   * Courier filter:
   * - undefined / '' → all couriers
   * - 'unassigned' → assigned_courier_id IS NULL
   * - uuid → assigned_courier_id = uuid
   */
  courierId?: string | null;
  search?: string;
  page: number;
  pageSize: AdminOrderPageSize | number;
}

export interface PaginatedOrdersResult {
  data: Order[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
}

/** Columns required by Admin Orders list / edit / details. */
export const ADMIN_ORDER_LIST_COLUMNS = [
  'id',
  'user_id',
  'sender_name',
  'sender_phone',
  'pickup_city',
  'pickup_district',
  'pickup_address',
  'recipient_name',
  'recipient_phone',
  'delivery_city',
  'delivery_district',
  'delivery_address',
  'parcel_count',
  'delivery_date',
  'notes',
  'status',
  'assigned_courier_id',
  'courier_sort_order',
  'amount_to_collect',
  'collected_amount',
  'payment_method',
  'is_fragile',
  'created_at',
  'updated_at',
  'delivered_at',
  'cancelled_at',
].join(', ');

export interface CreateOrderPayload {
  sender_name: string;
  sender_phone: string;
  pickup_city: string;
  pickup_district: string;
  pickup_address: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_city: string;
  delivery_district: string;
  delivery_address: string;
  parcel_count: number;
  delivery_date: string;
  amount_to_collect: number;
  is_fragile?: boolean;
  notes?: string | null;
}

export type AdminOrderEditPayload = Omit<CreateOrderPayload, never> & {
  notes?: string | null;
  is_fragile: boolean;
};

/** @deprecated Use AdminOrderFilters for Admin Orders list queries. */
export interface OrderFilters {
  search?: string;
  status?: OrderStatus | '';
  pickupCity?: string;
  deliveryCity?: string;
  deliveryDate?: string;
}

export interface AdminDashboardStats {
  totalUsers: number;
  totalOrders: number;
  pendingOrders: number;
  acceptedOrders: number;
  pickedUpOrders: number;
  inTransitOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
}

export interface CourierDailySummary {
  cashTotal: string;
  cardTotal: string;
  grandTotal: string;
  deliveredCount: number;
}

/** @deprecated Prefer completeOrder / cancelOrder / changeOrderStatus. */
export interface CourierOrderUpdate {
  status: CourierStatus;
  payment_method: PaymentMethod | null;
  collected_amount: string | number;
}
