import { Injectable, inject, isDevMode } from '@angular/core';
import {
  AdminOrderEditPayload,
  CreateOrderPayload,
  MY_ORDERS_PAGE_SIZE,
  MyOrdersQueryOptions,
  MyOrdersStatusCounts,
  Order,
  OrderStatus,
  PaginatedOrdersResult,
  UserDeliveredAnalytics,
  UserDeliveredAnalyticsFilters,
} from '../models/order.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { centsToNumber, normalizeOrder, normalizeOrders, toCents } from '../utils/order-status.util';
import { isDeliveryDateAllowed } from '../constants/cities';
import {
  isIsoDateOnly,
  tbilisiDayEndExclusiveIso,
  tbilisiDayStartIso,
} from '../utils/tbilisi-time.util';

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
    if (!(amount >= 0)) {
      return { data: null, error: 'ასაღები თანხა უნდა იყოს 0 ან მეტი.' };
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
      return { data: null, error: 'გადასაცემი ერთეულების რაოდენობა უნდა იყოს 1 ან მეტი.' };
    }

    const amount = centsToNumber(toCents(payload.amount_to_collect));
    if (!(amount >= 0)) {
      return { data: null, error: 'ასაღები თანხა უნდა იყოს 0 ან მეტი.' };
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
      return { data: null, error: 'გადასაცემი ერთეულების რაოდენობა უნდა იყოს 1 ან მეტი.' };
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

  /**
   * Owner My Orders list with server-side status / delivered_at filters + pagination.
   * Pass page/pageSize for Load More; omit both to fetch a single unbounded page
   * (legacy callers) — prefer pagination for the My Orders UI.
   */
  async getMyOrders(options: MyOrdersQueryOptions = {}): Promise<PaginatedOrdersResult> {
    const user = this.auth.user();
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, options.pageSize ?? MY_ORDERS_PAGE_SIZE));

    if (!user) {
      return { data: [], total: 0, page, pageSize, error: 'Not authenticated' };
    }

    const status = options.status ?? 'all';
    const paginate = options.page != null || options.pageSize != null;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const orderByDelivered = status === 'delivered';

    let query = this.supabase.client
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (status === 'delivered') {
      const deliveredFrom = options.deliveredFrom?.trim() ?? '';
      const deliveredTo = options.deliveredTo?.trim() ?? '';
      if (isIsoDateOnly(deliveredFrom)) {
        query = query.gte('delivered_at', tbilisiDayStartIso(deliveredFrom));
      }
      if (isIsoDateOnly(deliveredTo)) {
        query = query.lt('delivered_at', tbilisiDayEndExclusiveIso(deliveredTo));
      }
    }

    if (orderByDelivered) {
      query = query
        .order('delivered_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false }).order('id', { ascending: false });
    }

    if (paginate) {
      query = query.range(from, to);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logDevError('getMyOrders', error.message);
      return { data: [], total: 0, page, pageSize, error: error.message };
    }

    return {
      data: normalizeOrders(data ?? []),
      total: count ?? 0,
      page,
      pageSize,
      error: null,
    };
  }

  /** Exact status tab counts for the authenticated owner (head-only queries). */
  async getMyOrderStatusCounts(): Promise<{
    data: MyOrdersStatusCounts;
    error: string | null;
  }> {
    const empty: MyOrdersStatusCounts = {
      all: 0,
      pending: 0,
      picked_up: 0,
      delivered: 0,
      cancelled: 0,
    };

    const user = this.auth.user();
    if (!user) {
      return { data: empty, error: 'Not authenticated' };
    }

    const statuses: OrderStatus[] = ['pending', 'picked_up', 'delivered', 'cancelled'];
    const [allResult, ...statusResults] = await Promise.all([
      this.supabase.client
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      ...statuses.map((status) =>
        this.supabase.client
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('status', status),
      ),
    ]);

    const firstError =
      allResult.error?.message ??
      statusResults.find((r) => r.error)?.error?.message ??
      null;

    if (firstError) {
      this.logDevError('getMyOrderStatusCounts', firstError);
      return { data: empty, error: firstError };
    }

    return {
      data: {
        all: allResult.count ?? 0,
        pending: statusResults[0]?.count ?? 0,
        picked_up: statusResults[1]?.count ?? 0,
        delivered: statusResults[2]?.count ?? 0,
        cancelled: statusResults[3]?.count ?? 0,
      },
      error: null,
    };
  }

  /**
   * Owner delivered analytics via SECURITY DEFINER RPC.
   * Never sends user_id — RPC derives scope from auth.uid().
   */
  async getMyDeliveredAnalytics(
    filters: UserDeliveredAnalyticsFilters = {},
  ): Promise<{ data: UserDeliveredAnalytics; error: string | null }> {
    const empty: UserDeliveredAnalytics = {
      order_count: 0,
      parcel_count: 0,
      amount_to_collect: 0,
    };

    const user = this.auth.user();
    if (!user) {
      return { data: empty, error: 'Not authenticated' };
    }

    const year =
      typeof filters.year === 'number' && Number.isFinite(filters.year) ? filters.year : null;
    const month =
      typeof filters.month === 'number' && Number.isFinite(filters.month) ? filters.month : null;

    const useMonthYear = year != null;
    const params = useMonthYear
      ? {
          p_date_from: null as string | null,
          p_date_to: null as string | null,
          p_year: year,
          p_month: month,
        }
      : {
          p_date_from: isIsoDateOnly(filters.dateFrom) ? filters.dateFrom!.trim() : null,
          p_date_to: isIsoDateOnly(filters.dateTo) ? filters.dateTo!.trim() : null,
          p_year: null as number | null,
          p_month: null as number | null,
        };

    const { data, error } = await this.supabase.client.rpc('user_delivered_analytics', params);

    if (error) {
      this.logDevError('getMyDeliveredAnalytics', error.message);
      return { data: empty, error: error.message };
    }

    return { data: this.normalizeUserDeliveredAnalytics(data), error: null };
  }

  /** Distinct years that appear on the owner's orders (for year dropdown). */
  async getMyOrderYears(): Promise<{ data: number[]; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: [], error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select('created_at, delivered_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: newest, error: newestError } = await this.supabase.client
      .from('orders')
      .select('created_at, delivered_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || newestError) {
      const message = error?.message ?? newestError?.message ?? 'Failed to load years';
      this.logDevError('getMyOrderYears', message);
      return { data: this.defaultYearOptions(), error: message };
    }

    const years = new Set<number>(this.defaultYearOptions());
    for (const row of [...(data ?? []), ...(newest ?? [])]) {
      const created = row.created_at ? new Date(row.created_at as string) : null;
      const delivered = row.delivered_at ? new Date(row.delivered_at as string) : null;
      if (created && !Number.isNaN(created.getTime())) {
        years.add(created.getFullYear());
      }
      if (delivered && !Number.isNaN(delivered.getTime())) {
        years.add(delivered.getFullYear());
      }
    }

    return {
      data: [...years].sort((a, b) => b - a),
      error: null,
    };
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
      .order('id', { ascending: false })
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
    const { data, error } = await this.getMyOrderStatusCounts();
    if (error) {
      return { data: { total: 0, active: 0, completed: 0 }, error };
    }

    return {
      data: {
        total: data.all,
        active: data.pending + data.picked_up,
        completed: data.delivered + data.cancelled,
      },
      error: null,
    };
  }

  private normalizeUserDeliveredAnalytics(raw: unknown): UserDeliveredAnalytics {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    return {
      order_count: this.asNumber(obj['order_count']),
      parcel_count: this.asNumber(obj['parcel_count']),
      amount_to_collect: this.asNumber(obj['amount_to_collect']),
    };
  }

  private asNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private defaultYearOptions(): number[] {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= current - 5; y -= 1) {
      years.push(y);
    }
    return years;
  }

  private logDevError(context: string, message: string): void {
    if (isDevMode()) {
      console.error(`[OrdersService] ${context}:`, message);
    }
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
