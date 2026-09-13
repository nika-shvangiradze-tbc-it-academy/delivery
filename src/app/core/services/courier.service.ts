import { Injectable, inject } from '@angular/core';
import {
  CourierDailySummary,
  CourierOrderUpdate,
  Order,
} from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import {
  formatGel,
  normalizeOrder,
  normalizeOrders,
  summarizeCourierDay,
  toCents,
  centsToNumber,
} from '../utils/order-status.util';

const COURIER_ORDER_COLUMNS =
  'id, user_id, assigned_courier_id, recipient_name, recipient_phone, delivery_city, delivery_district, delivery_address, parcel_count, delivery_date, notes, status, payment_method, collected_amount, delivered_at, created_at, updated_at, sender_name, sender_phone, pickup_city, pickup_district, pickup_address';

@Injectable({
  providedIn: 'root',
})
export class CourierService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async getMyAssignedOrders(): Promise<{ data: Order[]; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select(COURIER_ORDER_COLUMNS)
      .eq('assigned_courier_id', user.id)
      .order('delivery_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data), error: null };
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
  ): Promise<{ data: Order | null; error: string | null }> {
    const amountNumber = centsToNumber(toCents(update.collected_amount));

    const { data, error } = await this.supabase.client.rpc('courier_update_order', {
      p_order_id: orderId,
      p_status: update.status,
      p_payment_method: update.payment_method,
      p_collected_amount: amountNumber,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: normalizeOrder(data as Order), error: null };
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
}
