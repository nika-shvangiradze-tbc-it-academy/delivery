import { Injectable, inject } from '@angular/core';
import {
  AdminDashboardStats,
  Order,
  OrderFilters,
  OrderStatus,
} from '../models/order.model';
import { CourierOption } from '../models/profile.model';
import { SupabaseService } from './supabase.service';
import { normalizeOrder, normalizeOrders } from '../utils/order-status.util';

@Injectable({
  providedIn: 'root',
})
export class AdminService {
  private readonly supabase = inject(SupabaseService);

  async getDashboardStats(): Promise<{ data: AdminDashboardStats; error: string | null }> {
    const [usersResult, ordersResult] = await Promise.all([
      this.supabase.client.from('profiles').select('id', { count: 'exact', head: true }),
      this.supabase.client.from('orders').select('status'),
    ]);

    if (usersResult.error) {
      return { data: this.emptyStats(), error: usersResult.error.message };
    }

    if (ordersResult.error) {
      return { data: this.emptyStats(), error: ordersResult.error.message };
    }

    const orders = (ordersResult.data ?? []) as Pick<Order, 'status'>[];

    return {
      data: {
        totalUsers: usersResult.count ?? 0,
        totalOrders: orders.length,
        pendingOrders: orders.filter((o) => o.status === 'pending').length,
        acceptedOrders: orders.filter((o) => o.status === 'accepted').length,
        pickedUpOrders: orders.filter((o) => o.status === 'picked_up').length,
        inTransitOrders: orders.filter((o) => o.status === 'in_transit').length,
        deliveredOrders: orders.filter((o) => o.status === 'delivered').length,
        cancelledOrders: orders.filter((o) => o.status === 'cancelled').length,
      },
      error: null,
    };
  }

  async getCouriers(): Promise<{ data: CourierOption[]; error: string | null }> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name, phone')
      .eq('role', 'courier')
      .order('full_name', { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: ((data ?? []) as CourierOption[]).map((c) => ({
        id: c.id,
        full_name: c.full_name ?? '',
        phone: c.phone ?? '',
      })),
      error: null,
    };
  }

  async getRecentOrders(limit = 8): Promise<{ data: Order[]; error: string | null }> {
    const { data, error } = await this.supabase.client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data), error: null };
  }

  async getAllOrders(filters: OrderFilters = {}): Promise<{ data: Order[]; error: string | null }> {
    let query = this.supabase.client.from('orders').select('*').order('created_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.pickupCity?.trim()) {
      query = query.ilike('pickup_city', `%${filters.pickupCity.trim()}%`);
    }

    if (filters.deliveryCity?.trim()) {
      query = query.ilike('delivery_city', `%${filters.deliveryCity.trim()}%`);
    }

    if (filters.deliveryDate) {
      query = query.eq('delivery_date', filters.deliveryDate);
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], error: error.message };
    }

    let orders = normalizeOrders(data);

    const search = filters.search?.trim().toLowerCase();
    if (search) {
      orders = orders.filter((order) => {
        const haystack = [
          String(order.id),
          order.recipient_name,
          order.recipient_phone,
          order.sender_name,
          order.sender_phone,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    return { data: orders, error: null };
  }

  async updateOrderStatus(
    orderId: number,
    status: OrderStatus,
  ): Promise<{ data: Order | null; error: string | null }> {
    const payload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'delivered') {
      payload['delivered_at'] = new Date().toISOString();
    } else {
      payload['delivered_at'] = null;
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .update(payload)
      .eq('id', orderId)
      .select('*')
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    return { data: normalizeOrder(data as Order), error: null };
  }

  async assignCourier(
    orderId: number,
    courierId: string | null,
  ): Promise<{ data: Order | null; error: string | null }> {
    const result = await this.assignCouriersBulk([orderId], courierId);
    if (result.error) {
      return { data: null, error: result.error };
    }
    return { data: result.data[0] ?? null, error: null };
  }

  async assignCouriersBulk(
    orderIds: number[],
    courierId: string | null,
  ): Promise<{ data: Order[]; error: string | null }> {
    const uniqueIds = [...new Set(orderIds)].filter((id) => Number.isFinite(id));
    if (uniqueIds.length === 0) {
      return { data: [], error: 'შეკვეთები არ არის მონიშნული' };
    }

    const payload: Record<string, unknown> = {
      assigned_courier_id: courierId,
      updated_at: new Date().toISOString(),
      status: courierId ? 'accepted' : 'pending',
    };

    const { data, error } = await this.supabase.client
      .from('orders')
      .update(payload)
      .in('id', uniqueIds)
      .select('*');

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data), error: null };
  }

  private emptyStats(): AdminDashboardStats {
    return {
      totalUsers: 0,
      totalOrders: 0,
      pendingOrders: 0,
      acceptedOrders: 0,
      pickedUpOrders: 0,
      inTransitOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
    };
  }
}
