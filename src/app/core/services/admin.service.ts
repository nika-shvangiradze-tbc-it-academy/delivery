import { Injectable, inject } from '@angular/core';
import {
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COURIER_UNASSIGNED,
  ADMIN_ORDER_LIST_COLUMNS,
  AdminDashboardStats,
  AdminOrderFilters,
  AdminStatusGroup,
  Order,
  OrderStatus,
  PaginatedOrdersResult,
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
      .select(ADMIN_ORDER_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logSupabaseError('getRecentOrders', error);
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data as unknown[]), error: null };
  }

  /**
   * Server-side Admin Orders list: status group, filters, search, pagination.
   * Never loads the full order history into memory.
   */
  async getAdminOrders(filters: AdminOrderFilters): Promise<PaginatedOrdersResult> {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.max(1, Math.min(100, filters.pageSize || 50));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase.client
      .from('orders')
      .select(ADMIN_ORDER_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    query = this.applyStatusGroup(query, filters.statusGroup);

    if (filters.pickupCity?.trim()) {
      query = query.eq('pickup_city', filters.pickupCity.trim());
    }

    if (filters.city?.trim()) {
      query = query.eq('delivery_city', filters.city.trim());
    }

    if (filters.date?.trim()) {
      query = query.eq('delivery_date', filters.date.trim());
    }

    const courierId = filters.courierId?.trim();
    if (courierId === ADMIN_COURIER_UNASSIGNED) {
      query = query.is('assigned_courier_id', null);
    } else if (courierId) {
      query = query.eq('assigned_courier_id', courierId);
    }

    const searchOr = this.buildSearchOrFilter(filters.search);
    if (searchOr) {
      query = query.or(searchOr);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logSupabaseError('getAdminOrders', error);
      return { data: [], total: 0, page, pageSize, error: error.message };
    }

    return {
      data: normalizeOrders(data as unknown[]),
      total: count ?? 0,
      page,
      pageSize,
      error: null,
    };
  }

  /** Whether an order matches the current Admin list filters (Realtime-ready). */
  orderMatchesAdminFilters(order: Order, filters: AdminOrderFilters): boolean {
    if (!this.statusMatchesGroup(order.status, filters.statusGroup)) {
      return false;
    }

    if (filters.pickupCity?.trim() && order.pickup_city !== filters.pickupCity.trim()) {
      return false;
    }

    if (filters.city?.trim() && order.delivery_city !== filters.city.trim()) {
      return false;
    }

    if (filters.date?.trim() && order.delivery_date !== filters.date.trim()) {
      return false;
    }

    const courierId = filters.courierId?.trim();
    if (courierId === ADMIN_COURIER_UNASSIGNED) {
      if (order.assigned_courier_id != null) return false;
    } else if (courierId && order.assigned_courier_id !== courierId) {
      return false;
    }

    const search = filters.search?.trim().toLowerCase();
    if (search) {
      if (/^\d+$/.test(search) && String(order.id) === search) {
        return true;
      }
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
      if (!haystack.includes(search)) {
        return false;
      }
    }

    return true;
  }

  statusMatchesGroup(status: OrderStatus, group: AdminStatusGroup): boolean {
    switch (group) {
      case 'pending':
        return status === 'pending';
      case 'active':
        return ADMIN_ACTIVE_STATUSES.includes(status);
      case 'delivered':
        return status === 'delivered';
      case 'cancelled':
        return status === 'cancelled';
      case 'all':
        return true;
    }
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
      .select(ADMIN_ORDER_LIST_COLUMNS)
      .single();

    if (error) {
      this.logSupabaseError('updateOrderStatus', error);
      return { data: null, error: error.message };
    }

    return { data: normalizeOrder(data as unknown as Order), error: null };
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
      .select(ADMIN_ORDER_LIST_COLUMNS);

    if (error) {
      this.logSupabaseError('assignCouriersBulk', error);
      return { data: [], error: error.message };
    }

    return { data: normalizeOrders(data as unknown[]), error: null };
  }

  private applyStatusGroup(query: any, group: AdminStatusGroup) {
    switch (group) {
      case 'pending':
        return query.eq('status', 'pending');
      case 'active':
        return query.in('status', [...ADMIN_ACTIVE_STATUSES]);
      case 'delivered':
        return query.eq('status', 'delivered');
      case 'cancelled':
        return query.eq('status', 'cancelled');
      case 'all':
      default:
        return query;
    }
  }

  /**
   * Safe PostgREST `.or()` filter for Admin search.
   * Never interpolates raw SQL — only sanitized PostgREST filter values.
   */
  private buildSearchOrFilter(rawSearch: string | undefined): string | null {
    const search = rawSearch?.trim();
    if (!search) return null;

    if (/^\d+$/.test(search)) {
      const id = Number(search);
      if (Number.isSafeInteger(id) && id > 0) {
        const phone = this.sanitizePostgrestValue(search);
        return `id.eq.${id},recipient_phone.ilike.%${phone}%,sender_phone.ilike.%${phone}%`;
      }
    }

    const value = this.sanitizePostgrestValue(search);
    if (!value) return null;

    return [
      `recipient_name.ilike.%${value}%`,
      `recipient_phone.ilike.%${value}%`,
      `sender_name.ilike.%${value}%`,
      `sender_phone.ilike.%${value}%`,
    ].join(',');
  }

  /** Strip characters that break PostgREST filter / or() parsing. */
  private sanitizePostgrestValue(value: string): string {
    return value
      .replace(/[%_,.()"'\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private logSupabaseError(
    context: string,
    error: { message?: string; details?: string; hint?: string; code?: string },
  ): void {
    console.error(`[AdminService.${context}]`, {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
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
