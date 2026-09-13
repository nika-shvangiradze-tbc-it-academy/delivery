export type OrderStatus =
  | 'pending'
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

export const COURIER_ALLOWED_STATUSES: OrderStatus[] = [
  'accepted',
  'picked_up',
  'in_transit',
  'delivered',
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
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  /** Amount in GEL as decimal number from Postgres numeric */
  collected_amount: number;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

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
  notes?: string | null;
}

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

export interface CourierOrderUpdate {
  status: OrderStatus;
  payment_method: PaymentMethod | null;
  collected_amount: string;
}
