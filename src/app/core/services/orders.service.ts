import { Injectable, inject } from '@angular/core';
import { CreateOrderPayload, Order, OrderStatus } from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { normalizeOrder, normalizeOrders } from '../utils/order-status.util';

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
