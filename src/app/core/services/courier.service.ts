import { Injectable, inject } from '@angular/core';
import {
  COURIER_ACTIVE_STATUS_FILTER,
  COURIER_ACTIVE_STATUSES,
  COURIER_HISTORY_STATUSES,
  CourierDailySummary,
  CourierStatus,
  Order,
  OrderStatus,
  PaymentMethod,
} from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import {
  formatGel,
  historyCompletedAt,
  normalizeOrder,
  normalizeOrders,
  parseCourierStatus,
  parsePaymentMethod,
  summarizeCourierDay,
} from '../utils/order-status.util';

const COURIER_ORDER_COLUMNS =
  'id, user_id, assigned_courier_id, recipient_name, recipient_phone, delivery_city, delivery_district, delivery_address, parcel_count, delivery_date, notes, is_fragile, status, payment_method, amount_to_collect, collected_amount, delivered_at, cancelled_at, cancellation_reason, courier_sort_order, created_at, updated_at, sender_name, sender_phone, pickup_city, pickup_district, pickup_address';

@Injectable({
  providedIn: 'root',
})
export class CourierService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async getMyActiveOrders(): Promise<{ data: Order[]; error: string | null }> {
    return this.getMyOrdersByStatuses([...COURIER_ACTIVE_STATUS_FILTER], 'active');
  }

  async getMyHistoryOrders(): Promise<{ data: Order[]; error: string | null }> {
    return this.getMyOrdersByStatuses([...COURIER_HISTORY_STATUSES], 'history');
  }

  /** @deprecated Prefer getMyActiveOrders / getMyHistoryOrders */
  async getMyAssignedOrders(): Promise<{ data: Order[]; error: string | null }> {
    return this.getMyActiveOrders();
  }

  async getOrderById(orderId: number): Promise<{ data: Order | null; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select(COURIER_ORDER_COLUMNS)
      .eq('id', orderId)
      .eq('assigned_courier_id', user.id)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data ? normalizeOrder(data as Order) : null, error: null };
  }

  async completeOrder(
    orderId: number,
    paymentMethod: PaymentMethod,
    assignedCourierId?: string | null,
  ): Promise<{ data: Order | null; error: string | null }> {
    const sessionCheck = await this.requireCourierSession(orderId, assignedCourierId);
    if (sessionCheck.error) {
      return { data: null, error: sessionCheck.error };
    }

    if (paymentMethod !== 'cash' && paymentMethod !== 'card') {
      return { data: null, error: 'აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.' };
    }

    const rpcArgs = {
      p_order_id: orderId,
      p_payment_method: paymentMethod,
    };

    const { data, error } = await this.supabase.client.rpc('courier_complete_order', rpcArgs);

    if (error) {
      this.logRpcError('courier_complete_order', error);
      return { data: null, error: this.mapCourierRpcError(error.message) };
    }

    return this.normalizeRpcRow(data, 'courier_complete_order');
  }

  async cancelOrder(
    orderId: number,
    cancellationReason: string,
    assignedCourierId?: string | null,
  ): Promise<{ data: Order | null; error: string | null }> {
    const sessionCheck = await this.requireCourierSession(orderId, assignedCourierId);
    if (sessionCheck.error) {
      return { data: null, error: sessionCheck.error };
    }

    const reason = cancellationReason.trim();
    if (!reason) {
      return { data: null, error: 'გთხოვთ მიუთითოთ გაუქმების მიზეზი' };
    }

    const { data, error } = await this.supabase.client.rpc('courier_cancel_order', {
      p_order_id: orderId,
      p_cancellation_reason: reason,
    });

    if (error) {
      this.logRpcError('courier_cancel_order', error);
      return { data: null, error: this.mapCourierRpcError(error.message) };
    }

    return this.normalizeRpcRow(data, 'courier_cancel_order');
  }

  async changeOrderStatus(
    orderId: number,
    newStatus: CourierStatus,
    paymentMethod: PaymentMethod | null = null,
    assignedCourierId?: string | null,
  ): Promise<{ data: Order | null; error: string | null }> {
    const sessionCheck = await this.requireCourierSession(orderId, assignedCourierId);
    if (sessionCheck.error) {
      return { data: null, error: sessionCheck.error };
    }

    const status = parseCourierStatus(newStatus);
    if (!status) {
      return { data: null, error: `არასწორი სტატუსი: ${String(newStatus)}` };
    }

    // History corrections / RPC allow only picked_up | delivered | cancelled.
    if (status === 'pending') {
      return { data: null, error: 'მოლოდინში სტატუსზე დაბრუნება შეუძლებელია' };
    }

    if (status === 'delivered') {
      const payment = parsePaymentMethod(paymentMethod);
      if (!payment) {
        return { data: null, error: 'აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.' };
      }
    }

    const rpcArgs: {
      p_order_id: number;
      p_status: CourierStatus;
      p_payment_method: PaymentMethod | null;
    } = {
      p_order_id: orderId,
      p_status: status,
      p_payment_method: status === 'delivered' ? parsePaymentMethod(paymentMethod) : null,
    };

    const { data, error } = await this.supabase.client.rpc('courier_change_order_status', rpcArgs);

    if (error) {
      this.logRpcError('courier_change_order_status', error);
      return { data: null, error: this.mapCourierRpcError(error.message) };
    }

    return this.normalizeRpcRow(data, 'courier_change_order_status');
  }

  async reorderActiveOrders(orderIds: number[]): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.rpc('courier_reorder_orders', {
      order_ids: orderIds,
    });

    if (error) {
      this.logRpcError('courier_reorder_orders', error);
      return { error: error.message };
    }

    return { error: null };
  }

  async getTodayDeliveredSummary(): Promise<{ data: CourierDailySummary; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return {
        data: { cashTotal: '0.00', cardTotal: '0.00', grandTotal: '0.00', deliveredCount: 0 },
        error: 'Not authenticated',
      };
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const { data, error } = await this.supabase.client
      .from('orders')
      .select('payment_method, collected_amount, status, delivered_at, assigned_courier_id')
      .eq('assigned_courier_id', user.id)
      .eq('status', 'delivered')
      .gte('delivered_at', start.toISOString())
      .lt('delivered_at', end.toISOString());

    if (error) {
      return {
        data: { cashTotal: '0.00', cardTotal: '0.00', grandTotal: '0.00', deliveredCount: 0 },
        error: error.message,
      };
    }

    return { data: summarizeCourierDay(normalizeOrders(data)), error: null };
  }

  formatAmount(amount: number): string {
    return formatGel(amount);
  }

  isActiveStatus(status: OrderStatus): boolean {
    return (COURIER_ACTIVE_STATUSES as OrderStatus[]).includes(status);
  }

  isHistoryStatus(status: OrderStatus): boolean {
    return (COURIER_HISTORY_STATUSES as OrderStatus[]).includes(status);
  }

  private async requireCourierSession(
    orderId: number,
    assignedCourierId?: string | null,
  ): Promise<{ error: string | null }> {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await this.supabase.client.auth.getSession();

      if (sessionError) {
        console.error('Courier session check failed:', sessionError);
        return { error: sessionError.message || 'Session check failed' };
      }

      if (!session?.user) {
        console.warn('Courier action aborted: no active session');
        return { error: 'სესია არ არის აქტიური. გთხოვთ თავიდან შეხვიდეთ.' };
      }

      const userId = session.user.id;

      if (assignedCourierId && assignedCourierId !== userId) {
        console.warn('Courier action aborted: order not assigned to current user', {
          orderId,
          assignedCourierId,
          userId,
        });
        return { error: 'ამ შეკვეთის შეცვლის უფლება არ გაქვთ.' };
      }

      return { error: null };
    } catch (err) {
      console.error('Courier session check unexpected error:', err);
      const message = err instanceof Error ? err.message : 'Unexpected session error';
      return { error: message };
    }
  }

  private normalizeRpcRow(
    data: unknown,
    rpcName: string,
  ): { data: Order | null; error: string | null } {
    const row = Array.isArray(data) ? data[0] : data;
    const normalized = normalizeOrder(row as Order);

    if (!normalized) {
      console.error(`${rpcName} returned empty data`, { data });
      return {
        data: null,
        error: 'შეკვეთის განახლება ვერ მოხერხდა. სცადეთ თავიდან.',
      };
    }

    return { data: normalized, error: null };
  }

  private mapCourierRpcError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('cancellation reason is required')) {
      return 'გთხოვთ მიუთითოთ გაუქმების მიზეზი';
    }
    if (
      lower.includes('cancellation reason cannot be changed') ||
      lower.includes('cancellation reason can only be set')
    ) {
      return 'გაუქმების მიზეზის შეცვლა შეუძლებელია.';
    }
    if (lower.includes('payment method required') || lower.includes('invalid payment')) {
      return 'აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.';
    }
    if (
      lower.includes('not found') ||
      lower.includes('not assigned') ||
      lower.includes('only couriers')
    ) {
      return 'ამ შეკვეთის შეცვლის უფლება არ გაქვთ.';
    }
    if (lower.includes('not authenticated')) {
      return 'სესია არ არის აქტიური. გთხოვთ თავიდან შეხვიდეთ.';
    }
    return message || 'შეცდომა მოხდა';
  }

  private logRpcError(
    rpcName: string,
    error: { message?: string; details?: string; hint?: string; code?: string },
  ): void {
    console.error(`${rpcName} failed:`, {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
  }

  private async getMyOrdersByStatuses(
    statuses: string[],
    mode: 'active' | 'history',
  ): Promise<{ data: Order[]; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    let query = this.supabase.client
      .from('orders')
      .select(COURIER_ORDER_COLUMNS)
      .eq('assigned_courier_id', user.id)
      .in('status', statuses);

    if (mode === 'active') {
      query = query
        .order('courier_sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    } else {
      query = query.order('updated_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], error: error.message };
    }

    const orders = normalizeOrders(data);
    if (mode === 'history') {
      orders.sort((a, b) => {
        const aTime = Date.parse(historyCompletedAt(a) ?? '') || 0;
        const bTime = Date.parse(historyCompletedAt(b) ?? '') || 0;
        return bTime - aTime;
      });
    }

    return { data: orders, error: null };
  }
}
