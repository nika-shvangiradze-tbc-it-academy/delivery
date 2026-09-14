import { Injectable, inject } from '@angular/core';
import {
  AdminOrderEditPayload,
  CreateOrderPayload,
  Order,
  OrderStatus,
} from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { centsToNumber, normalizeOrder, normalizeOrders, toCents } from '../utils/order-status.util';
import { isDeliveryDateAllowed } from '../constants/cities';

@Injectable({
  providedIn: 'root',
})
export class OrdersService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async createOrder(payload: CreateOrderPayload): Promise<{ data: Order | null; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    if (!isDeliveryDateAllowed(payload.delivery_date)) {
      return { data: null, error: 'მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.' };
    }

    const amount = centsToNumber(toCents(payload.amount_to_collect));
    if (!(amount > 0)) {
      return { data: null, error: 'ასაღები თანხა უნდა იყოს 0-ზე მეტი.' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .insert({
        sender_name: payload.sender_name,
        sender_phone: payload.sender_phone,
        pickup_city: payload.pickup_city,
        pickup_district: payload.pickup_district,
        pickup_address: payload.pickup_address,
        recipient_name: payload.recipient_name,
        recipient_phone: payload.recipient_phone,
        delivery_city: payload.delivery_city,
        delivery_district: payload.delivery_district,
        delivery_address: payload.delivery_address,
        parcel_count: payload.parcel_count,
        delivery_date: payload.delivery_date,
        amount_to_collect: amount,
        is_fragile: Boolean(payload.is_fragile),
        user_id: user.id,
        status: 'pending' as OrderStatus,
        notes: payload.notes?.trim() ? payload.notes.trim() : null,
      })
      .select('*')
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: normalizeOrder(data as Order), error: null };
  }

  async updateOrderDetails(
    orderId: number,
    payload: AdminOrderEditPayload,
    options?: { originalDeliveryDate?: string },
  ): Promise<{ data: Order | null; error: string | null }> {
    if (
      !isDeliveryDateAllowed(payload.delivery_date, {
        allowExistingPast: true,
        originalValue: options?.originalDeliveryDate,
      })
    ) {
      return { data: null, error: 'მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.' };
    }

    if (payload.parcel_count < 1) {
      return { data: null, error: 'ამანათების რაოდენობა უნდა იყოს 1 ან მეტი.' };
    }

    const amount = centsToNumber(toCents(payload.amount_to_collect));
    if (!(amount > 0)) {
      return { data: null, error: 'ასაღები თანხა უნდა იყოს 0-ზე მეტი.' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .update({
        sender_name: payload.sender_name,
        sender_phone: payload.sender_phone,
        pickup_city: payload.pickup_city,
        pickup_district: payload.pickup_district,
        pickup_address: payload.pickup_address,
        recipient_name: payload.recipient_name,
        recipient_phone: payload.recipient_phone,
        delivery_city: payload.delivery_city,
        delivery_district: payload.delivery_district,
        delivery_address: payload.delivery_address,
        parcel_count: payload.parcel_count,
        delivery_date: payload.delivery_date,
        amount_to_collect: amount,
        is_fragile: Boolean(payload.is_fragile),
        notes: payload.notes?.trim() ? payload.notes.trim() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select('*')
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: normalizeOrder(data as Order), error: null };
  }

  /**
   * Owner edit of customer fields while status is still pending.
   * Scoped to id + user_id + status so operational fields cannot be touched.
   */
  async updateMyPendingOrder(
    orderId: number,
    payload: AdminOrderEditPayload,
    options?: { originalDeliveryDate?: string },
  ): Promise<{ data: Order | null; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    if (
      !isDeliveryDateAllowed(payload.delivery_date, {
        allowExistingPast: true,
        originalValue: options?.originalDeliveryDate,
      })
    ) {
      return { data: null, error: 'მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.' };
    }

    if (payload.parcel_count < 1) {
      return { data: null, error: 'ამანათების რაოდენობა უნდა იყოს 1 ან მეტი.' };
    }

    const amount = centsToNumber(toCents(payload.amount_to_collect));
    if (!(amount >= 0)) {
      return { data: null, error: 'ასაღები თანხა უნდა იყოს 0 ან მეტი.' };
    }

    const updatePayload = {
      sender_name: payload.sender_name,
      sender_phone: payload.sender_phone,
      pickup_city: payload.pickup_city,
      pickup_district: payload.pickup_district,
      pickup_address: payload.pickup_address,
      recipient_name: payload.recipient_name,
      recipient_phone: payload.recipient_phone,
      delivery_city: payload.delivery_city,
      delivery_district: payload.delivery_district,
      delivery_address: payload.delivery_address,
      parcel_count: payload.parcel_count,
      delivery_date: payload.delivery_date,
      notes: payload.notes?.trim() ? payload.notes.trim() : null,
      is_fragile: Boolean(payload.is_fragile),
      amount_to_collect: amount,
    };

    const { data, error } = await this.supabase.client
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (error) {
      return { data: null, error: this.mapOwnerEditError(error.message) };
    }

    if (!data) {
      return {
        data: null,
        error: 'შეკვეთის რედაქტირება შესაძლებელია მხოლოდ მოლოდინის სტატუსში.',
      };
    }

    return { data: normalizeOrder(data as Order), error: null };
  }

  private mapOwnerEditError(message: string): string {
    if (message.includes('Order can only be edited while pending')) {
      return 'შეკვეთის რედაქტირება შესაძლებელია მხოლოდ მოლოდინის სტატუსში.';
    }
    return message;
  }

  async getMyOrders(): Promise<{ data: Order[]; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data), error: null };
  }

  async getMyRecentOrders(limit = 5): Promise<{ data: Order[]; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data), error: null };
  }

  async getMyOrderStats(): Promise<{
    data: { total: number; active: number; completed: number };
    error: string | null;
  }> {
    const { data, error } = await this.getMyOrders();
    if (error) {
      return { data: { total: 0, active: 0, completed: 0 }, error };
    }

    const completedStatuses: OrderStatus[] = ['delivered', 'cancelled'];
    const completed = data.filter((order) => completedStatuses.includes(order.status)).length;
    const active = data.length - completed;

    return {
      data: {
        total: data.length,
        active,
        completed,
      },
      error: null,
    };
  }

  async getOrderById(orderId: number): Promise<{ data: Order | null; error: string | null }> {
    const { data, error } = await this.supabase.client
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: data ? normalizeOrder(data as Order) : null, error: null };
  }
}
