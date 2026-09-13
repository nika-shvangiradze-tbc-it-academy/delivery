import { Injectable, inject } from '@angular/core';
import {
  COURIER_ACTIVE_STATUSES,
  COURIER_HISTORY_STATUSES,
  CourierDailySummary,
  CourierOrderUpdate,
  CourierStatus,
  Order,
  OrderStatus,
  PaymentMethod,
} from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import {
  centsToNumber,
  formatGel,
  historyCompletedAt,
  normalizeOrder,
  normalizeOrders,
  parseCourierStatus,
  parsePaymentMethod,
  summarizeCourierDay,
  toCents,
} from '../utils/order-status.util';

const COURIER_ORDER_COLUMNS =
  'id, user_id, assigned_courier_id, recipient_name, recipient_phone, delivery_city, delivery_district, delivery_address, parcel_count, delivery_date, notes, status, payment_method, amount_to_collect, collected_amount, delivered_at, cancelled_at, courier_sort_order, created_at, updated_at, sender_name, sender_phone, pickup_city, pickup_district, pickup_address';

@Injectable({
  providedIn: 'root',
})
export class CourierService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async getMyActiveOrders(): Promise<{ data: Order[]; error: string | null }> {
    return this.getMyOrdersByStatuses([...COURIER_ACTIVE_STATUSES], 'active');
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

  async updateAssignedOrder(
    orderId: number,
    update: CourierOrderUpdate,
    assignedCourierId?: string | null,
  ): Promise<{ data: Order | null; error: string | null }> {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await this.supabase.client.auth.getSession();

      if (sessionError) {
        console.error('Courier order save session check failed:', sessionError);
        return { data: null, error: sessionError.message || 'Session check failed' };
      }

      if (!session?.user) {
        console.warn('Courier order save aborted: no active session');
        return { data: null, error: 'სესია არ არის აქტიური. გთხოვთ თავიდან შეხვიდეთ.' };
      }

      const userId = session.user.id;

      if (assignedCourierId && assignedCourierId !== userId) {
        console.warn('Courier order save aborted: order not assigned to current user', {
          orderId,
          assignedCourierId,
          userId,
        });
        return {
          data: null,
          error: 'ეს შეკვეთა არ არის მინიჭებული მიმდინარე კურიერზე',
        };
      }

      if (!assignedCourierId) {
        console.warn('Courier order save: assigned_courier_id missing on local order', {
          orderId,
          userId,
        });
      }

      const status = parseCourierStatus(update.status);
      if (!status) {
        console.error('Courier order save invalid status:', update.status);
        return { data: null, error: `არასწორი სტატუსი: ${String(update.status)}` };
      }

      const paymentMethod = this.normalizePaymentMethod(update.payment_method);
      const collectedAmount = this.normalizeCollectedAmount(update.collected_amount);

      const rpcArgs: {
        p_order_id: number;
        p_status: CourierStatus;
        p_payment_method: PaymentMethod | null;
        p_collected_amount: number;
      } = {
        p_order_id: orderId,
        p_status: status,
        p_payment_method: paymentMethod,
        p_collected_amount: collectedAmount,
      };

      console.info('Courier order save RPC courier_update_order', rpcArgs);

      const { data, error } = await this.supabase.client.rpc('courier_update_order', rpcArgs);

      if (error) {
        console.error('Courier order save failed:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          rpcArgs,
        });
        return { data: null, error: error.message || 'Unknown Supabase error' };
      }

      const row = Array.isArray(data) ? data[0] : data;
      const normalized = normalizeOrder(row as Order);

      if (!normalized) {
        console.error('Courier order save returned empty data', { data, rpcArgs });
        return {
          data: null,
          error:
            'RPC returned empty result (check courier_update_order SECURITY DEFINER / assignment)',
        };
      }

      return { data: normalized, error: null };
    } catch (err) {
      console.error('Courier order save unexpected error:', err);
      const message = err instanceof Error ? err.message : 'Unexpected save error';
      return { data: null, error: message };
    }
  }

  async reorderActiveOrders(orderIds: number[]): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.rpc('courier_reorder_orders', {
      order_ids: orderIds,
    });

    if (error) {
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

  private normalizePaymentMethod(value: unknown): PaymentMethod | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = parsePaymentMethod(value);
    if (!parsed) {
      console.warn('Courier order save: dropping non-English payment label', value);
    }
    return parsed;
  }

  private normalizeCollectedAmount(value: string | number | null | undefined): number {
    const amount = centsToNumber(toCents(value));
    return Number.isFinite(amount) ? amount : 0;
  }

  private async getMyOrdersByStatuses(
    statuses: OrderStatus[],
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
