export type OrderStatus = 'pending' | 'picked_up' | 'delivered' | 'cancelled';

/** Status values couriers may set (English DB values only — not UI labels). */
export type CourierStatus = 'pending' | 'picked_up' | 'delivered' | 'cancelled';

export type PaymentMethod = 'cash' | 'card';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'picked_up',
  'delivered',
  'cancelled',
];

/** @deprecated Prefer complete/cancel RPCs; kept for correction UI labels. */
export const COURIER_ALLOWED_STATUSES: CourierStatus[] = [
  'pending',
  'picked_up',
  'delivered',
  'cancelled',
];

/** Statuses a courier may restore/correct to from history (never pending). */
export const COURIER_CORRECTION_STATUSES: CourierStatus[] = [
  'picked_up',
  'delivered',
  'cancelled',
];

/** @deprecated Prefer COURIER_CORRECTION_STATUSES — history must not offer pending. */
export const COURIER_HISTORY_CORRECTION_STATUSES = COURIER_CORRECTION_STATUSES;
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
  /** Courier cancellation reason — immutable after first write. */
  cancellation_reason: string | null;
  /** Persistent manual route order for the assigned courier */
  courier_sort_order: number | null;
  created_at: string;
  updated_at: string;
}

/** Assigned courier work queue (pending = assigned awaiting pickup). */
export const COURIER_ACTIVE_STATUSES: OrderStatus[] = ['pending', 'picked_up'];

/**
 * Active-list query values including legacy statuses until the DB migration runs.
 * Rows are normalized to the 4-status model in the client.
 */
export const COURIER_ACTIVE_STATUS_FILTER: string[] = [
  'pending',
  'picked_up',
  'accepted',
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

/** Admin "აქტიური" tab — picked up only (canonical). */
export const ADMIN_ACTIVE_STATUSES: OrderStatus[] = ['picked_up'];

/** Includes legacy accepted/in_transit until migration is applied. */
export const ADMIN_ACTIVE_STATUS_FILTER: string[] = [
  'picked_up',
  'accepted',
  'in_transit',
];

export type AdminDatePreset = 'all' | 'today' | 'tomorrow' | 'custom';

export const ADMIN_ORDER_PAGE_SIZES = [30, 50, 100] as const;
export type AdminOrderPageSize = (typeof ADMIN_ORDER_PAGE_SIZES)[number];

export const ADMIN_PAGE_SIZE_STORAGE_KEY = 'admin.orderPageSize';

/**
 * Sentinel for "unassigned" courier filter.
 * Empty / undefined = all couriers; uuid = specific courier.
 */
export const ADMIN_COURIER_UNASSIGNED = 'unassigned' as const;

export type AdminPaymentMethodFilter = 'all' | PaymentMethod;

export interface AdminOrderFilters {
  statusGroup: AdminStatusGroup;
  /** Optional delivery_date filter (non-delivered tabs). Null/empty = all dates. */
  date?: string | null;
  /**
   * Delivered-tab date range on delivery_date (visible "მიწოდების თარიღი").
   * Analytics RPC still uses delivered_at separately.
   */
  deliveredDateFrom?: string | null;
  deliveredDateTo?: string | null;
  pickupCity?: string | null;
  city?: string | null;
  /**
   * Courier filter:
   * - undefined / '' → all couriers
   * - 'unassigned' → assigned_courier_id IS NULL
   * - uuid → assigned_courier_id = uuid
   */
  courierId?: string | null;
  /** Payment method filter (typically delivered tab). */
  paymentMethod?: AdminPaymentMethodFilter | null;
  search?: string;
  page: number;
  pageSize: AdminOrderPageSize | number;
}

export interface AdminDeliveredAnalyticsFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  city?: string | null;
  courierId?: string | null;
  paymentMethod?: AdminPaymentMethodFilter | null;
}

export interface AdminDeliveredAnalyticsSummary {
  order_count: number;
  parcel_count: number;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
}

export interface AdminDeliveredCityBreakdown {
  city: string;
  order_count: number;
  parcel_count: number;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
}

export interface AdminDeliveredCourierBreakdown {
  courier_id: string | null;
  full_name: string;
  order_count: number;
  parcel_count: number;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
}

export interface AdminDeliveredAnalytics {
  summary: AdminDeliveredAnalyticsSummary;
  by_city: AdminDeliveredCityBreakdown[];
  by_courier: AdminDeliveredCourierBreakdown[];
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
  'cancellation_reason',
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
  pickedUpOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
}

/** Admin-facing order status audit row (trigger-written; read-only). */
export type OrderStatusAuditRole = 'admin' | 'courier' | 'user' | 'system';
export type OrderStatusAuditSource = 'admin' | 'courier' | 'user' | 'system';

export interface OrderStatusAuditEntry {
  id: number;
  order_id: number;
  changed_by: string | null;
  changed_by_role: OrderStatusAuditRole | string | null;
  old_status: OrderStatus | string | null;
  new_status: OrderStatus | string;
  source: OrderStatusAuditSource | string | null;
  changed_at: string;
  actor_name: string | null;
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
