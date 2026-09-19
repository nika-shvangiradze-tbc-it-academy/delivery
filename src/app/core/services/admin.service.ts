import { Injectable, inject, isDevMode } from '@angular/core';
import {
  ADMIN_ACTIVE_STATUS_FILTER,
  ADMIN_ACTIVE_STATUSES,
  ADMIN_COURIER_UNASSIGNED,
  ADMIN_ORDER_LIST_COLUMNS,
  AdminCustomerTypeFilter,
  AdminDashboardStats,
  AdminDeliveredAnalytics,
  AdminDeliveredAnalyticsFilters,
  AdminOrderFilters,
  AdminOrderGroupBy,
  AdminPlanningBreakdown,
  AdminPlanningBucket,
  AdminPlanningPickupLocation,
  AdminStatusGroup,
  Order,
  OrderStatus,
  OrderStatusAuditEntry,
  PaginatedOrdersResult,
  PickupTask,
  AdminPickupTaskCounts,
  AdminPickupTaskStatusFilter,
  AdminPickupTasksResult,
} from '../models/order.model';
import { CourierOption } from '../models/profile.model';
import { ADMIN_COMPANY_SENDER_OR, isCompanyCustomer } from '../utils/admin-customer.util';
import { SupabaseService } from './supabase.service';
import { normalizeLegacyStatus, normalizeOrder, normalizeOrders } from '../utils/order-status.util';

/** Georgia has no DST; align delivered_at day bounds with RPC Asia/Tbilisi. */
const TBILISI_OFFSET = '+04:00';

function emptyDeliveredAnalytics(): AdminDeliveredAnalytics {
  return {
    summary: {
      order_count: 0,
      parcel_count: 0,
      total_amount: 0,
      cash_amount: 0,
      card_amount: 0,
    },
    by_city: [],
    by_courier: [],
  };
}

/**
 * Start of calendar day in Asia/Tbilisi, as UTC ISO (Z).
 * Always use toISOString() — raw "+04:00" breaks PostgREST query strings
 * because "+" is decoded as a space.
 */
function tbilisiDayStartIso(dateStr: string): string {
  return new Date(`${dateStr.trim()}T00:00:00${TBILISI_OFFSET}`).toISOString();
}

/** Exclusive end = start of next Tbilisi calendar day (UTC ISO). */
function tbilisiDayEndExclusiveIso(dateStr: string): string {
  const start = new Date(`${dateStr.trim()}T00:00:00${TBILISI_OFFSET}`);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function isIsoDateOnly(value: string | null | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

@Injectable({
  providedIn: 'root',
})
export class AdminService {
  private readonly supabase = inject(SupabaseService);

  async getDashboardStats(): Promise<{ data: AdminDashboardStats; error: string | null }> {
    const [usersResult, statsResult] = await Promise.all([
      this.supabase.client.from('profiles').select('id', { count: 'exact', head: true }),
      this.supabase.client.rpc('admin_dashboard_stats'),
    ]);

    if (usersResult.error) {
      return { data: this.emptyStats(), error: usersResult.error.message };
    }

    if (statsResult.error) {
      this.logSupabaseError('getDashboardStats', statsResult.error);
      return { data: this.emptyStats(), error: statsResult.error.message };
    }

    const raw =
      statsResult.data && typeof statsResult.data === 'object' && !Array.isArray(statsResult.data)
        ? (statsResult.data as Record<string, unknown>)
        : {};

    return {
      data: {
        totalUsers: usersResult.count ?? 0,
        totalOrders: asNumber(raw['total']),
        pendingOrders: asNumber(raw['pending']),
        pickedUpOrders: asNumber(raw['picked_up']),
        deliveredOrders: asNumber(raw['delivered']),
        cancelledOrders: asNumber(raw['cancelled']),
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
    const customerType = this.normalizeCustomerType(filters.customerType);

    if (customerType === 'company' || customerType === 'individual') {
      return this.getAdminOrdersViaCustomerTypeRpc(filters, page, pageSize, customerType);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase.client
      .from('orders')
      .select(ADMIN_ORDER_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    query = this.applyAdminListFilters(query, filters);

    const { data, error, count } = await query;

    if (error) {
      this.logSupabaseError('getAdminOrders', error);
      return { data: [], total: 0, page, pageSize, error: error.message };
    }

    const orders = await this.enrichOrdersWithOwners(normalizeOrders(data as unknown[]));

    return {
      data: orders,
      total: count ?? 0,
      page,
      pageSize,
      error: null,
    };
  }

  /**
   * Dispatcher planning aggregates (customer / pickup city / pickup location).
   * Requires admin_order_planning_breakdown RPC migration.
   */
  async getOrderPlanningBreakdown(
    filters: AdminOrderFilters,
    groupBy: Exclude<AdminOrderGroupBy, 'none'>,
  ): Promise<{ data: AdminPlanningBreakdown; error: string | null }> {
    const payment =
      filters.paymentMethod === 'cash' || filters.paymentMethod === 'card'
        ? filters.paymentMethod
        : null;
    const courierRaw = filters.courierId?.trim() || null;
    const customerType = this.normalizeCustomerType(filters.customerType);
    const isDelivered = filters.statusGroup === 'delivered';

    const { data, error } = await this.supabase.client.rpc('admin_order_planning_breakdown', {
      p_status_group: filters.statusGroup,
      p_group_by: groupBy,
      p_delivery_date: !isDelivered && isIsoDateOnly(filters.date) ? filters.date!.trim() : null,
      p_delivered_date_from:
        isDelivered && isIsoDateOnly(filters.deliveredDateFrom)
          ? filters.deliveredDateFrom!.trim()
          : null,
      p_delivered_date_to:
        isDelivered && isIsoDateOnly(filters.deliveredDateTo)
          ? filters.deliveredDateTo!.trim()
          : null,
      p_pickup_city: filters.pickupCity?.trim() || null,
      p_delivery_city: filters.city?.trim() || null,
      p_courier_id: courierRaw,
      p_customer_type: customerType,
      p_customer_user_id: filters.customerUserId?.trim() || null,
      p_payment_method: payment,
    });

    if (error) {
      this.logSupabaseError('getOrderPlanningBreakdown', error);
      return { data: { total: 0, groups: [] }, error: error.message };
    }

    return { data: this.normalizePlanningBreakdown(data), error: null };
  }

  /** Role=user accounts for the customer filter dropdown (narrow columns only). */
  async getOrderCustomers(): Promise<{
    data: Array<{ id: string; full_name: string }>;
    error: string | null;
  }> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'user')
      .order('full_name', { ascending: true })
      .limit(500);

    if (error) {
      this.logSupabaseError('getOrderCustomers', error);
      return { data: [], error: error.message };
    }

    return {
      data: ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => ({
        id: row.id,
        full_name: (row.full_name ?? '').trim() || '—',
      })),
      error: null,
    };
  }

  private async getAdminOrdersViaCustomerTypeRpc(
    filters: AdminOrderFilters,
    page: number,
    pageSize: number,
    customerType: 'company' | 'individual',
  ): Promise<PaginatedOrdersResult> {
    const payment =
      filters.paymentMethod === 'cash' || filters.paymentMethod === 'card'
        ? filters.paymentMethod
        : null;
    const isDelivered = filters.statusGroup === 'delivered';

    const { data: rpcData, error: rpcError } = await this.supabase.client.rpc(
      'admin_orders_ids_for_customer_type',
      {
        p_status_group: filters.statusGroup,
        p_customer_type: customerType,
        p_delivery_date: !isDelivered && isIsoDateOnly(filters.date) ? filters.date!.trim() : null,
        p_delivered_date_from:
          isDelivered && isIsoDateOnly(filters.deliveredDateFrom)
            ? filters.deliveredDateFrom!.trim()
            : null,
        p_delivered_date_to:
          isDelivered && isIsoDateOnly(filters.deliveredDateTo)
            ? filters.deliveredDateTo!.trim()
            : null,
        p_pickup_city: filters.pickupCity?.trim() || null,
        p_delivery_city: filters.city?.trim() || null,
        p_courier_id: filters.courierId?.trim() || null,
        p_customer_user_id: filters.customerUserId?.trim() || null,
        p_payment_method: payment,
        p_search: filters.search?.trim() || null,
        p_page: page,
        p_page_size: pageSize,
      },
    );

    if (rpcError) {
      this.logSupabaseError('getAdminOrdersViaCustomerTypeRpc', rpcError);
      // Fallback until migration is applied: sender-name legal-entity markers only.
      return this.getAdminOrdersCustomerTypeFallback(filters, page, pageSize, customerType);
    }

    const root = (rpcData && typeof rpcData === 'object' ? rpcData : {}) as Record<
      string,
      unknown
    >;
    const total = asNumber(root['total']);
    const ids = Array.isArray(root['ids'])
      ? root['ids'].map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      : [];

    if (ids.length === 0) {
      return { data: [], total, page, pageSize, error: null };
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .select(ADMIN_ORDER_LIST_COLUMNS)
      .in('id', ids);

    if (error) {
      this.logSupabaseError('getAdminOrdersViaCustomerTypeRpc.select', error);
      return { data: [], total: 0, page, pageSize, error: error.message };
    }

    const byId = new Map(
      normalizeOrders(data as unknown[]).map((order) => [order.id, order] as const),
    );
    const ordered = ids.map((id) => byId.get(id)).filter((o): o is Order => Boolean(o));
    const enriched = await this.enrichOrdersWithOwners(ordered);

    return { data: enriched, total, page, pageSize, error: null };
  }

  private async getAdminOrdersCustomerTypeFallback(
    filters: AdminOrderFilters,
    page: number,
    pageSize: number,
    customerType: 'company' | 'individual',
  ): Promise<PaginatedOrdersResult> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const companyOr = ADMIN_COMPANY_SENDER_OR;

    let query = this.supabase.client
      .from('orders')
      .select(ADMIN_ORDER_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    query = this.applyAdminListFilters(query, filters);

    if (customerType === 'company') {
      query = query.or(companyOr);
    } else {
      for (const pattern of [
        '%შპს%',
        '%სს.%',
        '%სს %',
        '%LLC%',
        '%LTD%',
        '%კომპანია%',
        '%ი/მ%',
        '%Company%',
      ]) {
        query = query.not('sender_name', 'ilike', pattern);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      this.logSupabaseError('getAdminOrdersCustomerTypeFallback', error);
      return { data: [], total: 0, page, pageSize, error: error.message };
    }

    return {
      data: await this.enrichOrdersWithOwners(normalizeOrders(data as unknown[])),
      total: count ?? 0,
      page,
      pageSize,
      error: null,
    };
  }

  private applyAdminListFilters(query: any, filters: AdminOrderFilters): any {
    let next = this.applyStatusGroup(query, filters.statusGroup);

    if (filters.pickupCity?.trim()) {
      next = next.eq('pickup_city', filters.pickupCity.trim());
    }

    if (filters.city?.trim()) {
      next = next.eq('delivery_city', filters.city.trim());
    }

    if (filters.customerUserId?.trim()) {
      next = next.eq('user_id', filters.customerUserId.trim());
    }

    if (filters.statusGroup === 'delivered') {
      const fromDate = filters.deliveredDateFrom?.trim() ?? '';
      const toDate = filters.deliveredDateTo?.trim() ?? '';
      if (isIsoDateOnly(fromDate)) {
        next = next.gte('delivery_date', fromDate);
      }
      if (isIsoDateOnly(toDate)) {
        next = next.lte('delivery_date', toDate);
      }
    } else if (filters.date?.trim()) {
      next = next.eq('delivery_date', filters.date.trim());
    }

    const courierId = filters.courierId?.trim();
    if (courierId === ADMIN_COURIER_UNASSIGNED) {
      next = next.is('assigned_courier_id', null);
    } else if (courierId) {
      next = next.eq('assigned_courier_id', courierId);
    }

    const payment = filters.paymentMethod;
    if (payment === 'cash' || payment === 'card') {
      next = next.eq('payment_method', payment);
    }

    const searchOr = this.buildSearchOrFilter(filters.search);
    if (searchOr) {
      next = next.or(searchOr);
    }

    return next;
  }

  private async enrichOrdersWithOwners(orders: Order[]): Promise<Order[]> {
    if (orders.length === 0) return orders;

    const userIds = [...new Set(orders.map((o) => o.user_id).filter(Boolean))];
    if (userIds.length === 0) return orders;

    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);

    if (error) {
      this.logSupabaseError('enrichOrdersWithOwners', error);
      return orders;
    }

    const nameById = new Map(
      ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [
        row.id,
        (row.full_name ?? '').trim() || null,
      ]),
    );

    return orders.map((order) => ({
      ...order,
      owner_name: nameById.get(order.user_id) ?? order.owner_name ?? null,
    }));
  }

  private normalizeCustomerType(
    value: AdminCustomerTypeFilter | null | undefined,
  ): AdminCustomerTypeFilter {
    return value === 'company' || value === 'individual' ? value : 'all';
  }

  private normalizePlanningBreakdown(raw: unknown): AdminPlanningBreakdown {
    const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const groupsRaw = Array.isArray(root['groups']) ? root['groups'] : [];
    return {
      total: asNumber(root['total']),
      groups: groupsRaw.map((row) => this.normalizePlanningBucket(row)).filter(Boolean) as AdminPlanningBucket[],
    };
  }

  private normalizePlanningBucket(raw: unknown): AdminPlanningBucket | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const childrenRaw = Array.isArray(r['children']) ? r['children'] : [];
    const locationsRaw = Array.isArray(r['pickup_locations']) ? r['pickup_locations'] : [];
    const citiesRaw = Array.isArray(r['cities']) ? r['cities'] : [];
    return {
      key: typeof r['key'] === 'string' ? r['key'] : String(r['key'] ?? ''),
      label: typeof r['label'] === 'string' && r['label'].trim() ? r['label'] : '—',
      order_count: asNumber(r['order_count']),
      user_id: typeof r['user_id'] === 'string' ? r['user_id'] : null,
      pickup_city: typeof r['pickup_city'] === 'string' ? r['pickup_city'] : null,
      is_company: typeof r['is_company'] === 'boolean' ? r['is_company'] : undefined,
      phone: typeof r['phone'] === 'string' && r['phone'].trim() ? r['phone'].trim() : null,
      parcel_count: r['parcel_count'] != null ? asNumber(r['parcel_count']) : undefined,
      total_amount: r['total_amount'] != null ? asNumber(r['total_amount']) : undefined,
      location_count: r['location_count'] != null ? asNumber(r['location_count']) : undefined,
      cities: citiesRaw
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim()),
      pickup_locations: locationsRaw
        .map((loc) => this.normalizePickupLocation(loc))
        .filter((loc): loc is NonNullable<typeof loc> => loc !== null),
      children: childrenRaw
        .map((child) => this.normalizePlanningBucket(child))
        .filter((child): child is AdminPlanningBucket => child !== null),
    };
  }

  private normalizePickupLocation(raw: unknown): AdminPlanningPickupLocation | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const key = typeof r['key'] === 'string' ? r['key'] : '';
    const label = typeof r['label'] === 'string' && r['label'].trim() ? r['label'].trim() : '';
    if (!key && !label) return null;
    return {
      key: key || label,
      label: label || key || '—',
      city: typeof r['city'] === 'string' ? r['city'] : null,
      district: typeof r['district'] === 'string' ? r['district'] : null,
      address: typeof r['address'] === 'string' ? r['address'] : null,
      order_count: asNumber(r['order_count']),
      parcel_count: r['parcel_count'] != null ? asNumber(r['parcel_count']) : undefined,
      total_amount: r['total_amount'] != null ? asNumber(r['total_amount']) : undefined,
    };
  }

  /**
   * Assign or reassign a Pickup Task for a customer.
   * One customer → one active pickup_task → one profile pickup location.
   * Does not create or reassign delivery orders.
   */
  async assignPickup(params: {
    customerUserId: string;
    courierId: string;
    filters: AdminOrderFilters;
  }): Promise<{
    updated: number;
    tasksCreated: number;
    tasksUpdated: number;
    error: string | null;
  }> {
    const { data, error } = await this.supabase.client.rpc('admin_assign_pickup', {
      p_customer_user_id: params.customerUserId,
      p_courier_id: params.courierId,
      p_status_group: params.filters.statusGroup,
      p_delivery_date:
        params.filters.statusGroup !== 'delivered' && isIsoDateOnly(params.filters.date)
          ? params.filters.date!.trim()
          : null,
      p_pickup_city: params.filters.pickupCity?.trim() || null,
      p_delivery_city: params.filters.city?.trim() || null,
    });

    if (error) {
      this.logSupabaseError('assignPickup', error);
      return { updated: 0, tasksCreated: 0, tasksUpdated: 0, error: error.message };
    }

    const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      updated: asNumber(root['updated'] ?? root['orders_linked']),
      tasksCreated: asNumber(root['tasks_created']),
      tasksUpdated: asNumber(root['tasks_updated']),
      error: null,
    };
  }

  /**
   * Admin pickup task list via admin_get_pickup_tasks RPC.
   * Source: pickup_tasks + one pickup_task_locations row — not delivery orders.
   * Legacy DB status "completed" is folded into "picked_up" for the UI.
   */
  async getPickupTasks(
    status: AdminPickupTaskStatusFilter = 'all',
  ): Promise<{ data: AdminPickupTasksResult; error: string | null }> {
    const emptyCounts: AdminPickupTaskCounts = {
      assigned: 0,
      picked_up: 0,
      cancelled: 0,
    };

    // Always load full set so legacy "completed" can fold into picked_up counts/list.
    const { data, error } = await this.supabase.client.rpc('admin_get_pickup_tasks', {
      p_status: 'all',
    });

    if (error) {
      this.logSupabaseError('getPickupTasks', error);
      return { data: { tasks: [], counts: emptyCounts }, error: error.message };
    }

    const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const tasksRaw = Array.isArray(root['tasks']) ? root['tasks'] : [];
    const countsRaw =
      root['counts'] && typeof root['counts'] === 'object'
        ? (root['counts'] as Record<string, unknown>)
        : {};

    let tasks = tasksRaw
      .map((row) => this.normalizeAdminPickupTask(row))
      .filter((t): t is PickupTask => t !== null);

    const counts: AdminPickupTaskCounts = {
      assigned: asNumber(countsRaw['assigned']),
      picked_up: asNumber(countsRaw['picked_up']) + asNumber(countsRaw['completed']),
      cancelled: asNumber(countsRaw['cancelled']),
    };

    if (status !== 'all') {
      tasks = tasks.filter((t) => t.status === status);
    }

    return { data: { tasks, counts }, error: null };
  }

  private normalizeAdminPickupTask(raw: unknown): PickupTask | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = Number(r['id']);
    if (!Number.isFinite(id) || id <= 0) return null;

    const statusRaw = r['status'];
    // Fold legacy "completed" into picked_up for UI.
    const status: PickupTask['status'] =
      statusRaw === 'cancelled'
        ? 'cancelled'
        : statusRaw === 'picked_up' || statusRaw === 'completed'
          ? 'picked_up'
          : 'assigned';

    const locationsRaw = r['pickup_task_locations'] ?? r['locations'];
    let locations: PickupTask['locations'] = [];
    if (Array.isArray(locationsRaw)) {
      for (const loc of locationsRaw) {
        if (!loc || typeof loc !== 'object') continue;
        const lr = loc as Record<string, unknown>;
        const locId = Number(lr['id'] ?? 0);
        locations.push({
          id: Number.isFinite(locId) ? locId : 0,
          pickup_task_id: id,
          city: typeof lr['city'] === 'string' && lr['city'].trim() ? lr['city'].trim() : null,
          district:
            typeof lr['district'] === 'string' && lr['district'].trim()
              ? lr['district'].trim()
              : null,
          address:
            typeof lr['address'] === 'string' && lr['address'].trim() ? lr['address'].trim() : null,
          parcel_count: asNumber(lr['parcel_count']),
          created_at: typeof lr['created_at'] === 'string' ? lr['created_at'] : '',
        });
      }
      locations.sort((a, b) => a.id - b.id);
    }
    if (locations.length > 1) {
      locations = [locations[0]];
    }
    if (
      locations.length === 0 &&
      (r['pickup_city'] || r['pickup_district'] || r['pickup_address'])
    ) {
      locations = [
        {
          id: 0,
          pickup_task_id: id,
          city:
            typeof r['pickup_city'] === 'string' && r['pickup_city'].trim()
              ? r['pickup_city'].trim()
              : null,
          district:
            typeof r['pickup_district'] === 'string' && r['pickup_district'].trim()
              ? r['pickup_district'].trim()
              : null,
          address:
            typeof r['pickup_address'] === 'string' && r['pickup_address'].trim()
              ? r['pickup_address'].trim()
              : null,
          parcel_count: asNumber(r['parcel_count']),
          created_at: typeof r['created_at'] === 'string' ? r['created_at'] : '',
        },
      ];
    }

    const courierEmbed = r['courier'];
    let courierName: string | null =
      typeof r['courier_name'] === 'string' && r['courier_name'].trim()
        ? r['courier_name'].trim()
        : null;
    if (!courierName && courierEmbed && typeof courierEmbed === 'object' && !Array.isArray(courierEmbed)) {
      const name = (courierEmbed as Record<string, unknown>)['full_name'];
      if (typeof name === 'string' && name.trim()) {
        courierName = name.trim();
      }
    }

    return {
      id,
      customer_id: String(r['customer_id'] ?? ''),
      assigned_courier_id: String(r['assigned_courier_id'] ?? ''),
      status,
      order_count: asNumber(r['order_count']),
      parcel_count: asNumber(r['parcel_count']),
      customer_name:
        typeof r['customer_name'] === 'string' && r['customer_name'].trim()
          ? r['customer_name'].trim()
          : null,
      pickup_phone:
        typeof r['pickup_phone'] === 'string' && r['pickup_phone'].trim()
          ? r['pickup_phone'].trim()
          : null,
      pickup_city:
        typeof r['pickup_city'] === 'string' && r['pickup_city'].trim()
          ? r['pickup_city'].trim()
          : null,
      pickup_district:
        typeof r['pickup_district'] === 'string' && r['pickup_district'].trim()
          ? r['pickup_district'].trim()
          : null,
      pickup_address:
        typeof r['pickup_address'] === 'string' && r['pickup_address'].trim()
          ? r['pickup_address'].trim()
          : null,
      location_key:
        typeof r['location_key'] === 'string' && r['location_key'].trim()
          ? r['location_key'].trim()
          : null,
      completed_at: typeof r['completed_at'] === 'string' ? r['completed_at'] : null,
      cancelled_at: typeof r['cancelled_at'] === 'string' ? r['cancelled_at'] : null,
      cancellation_reason:
        typeof r['cancellation_reason'] === 'string' && r['cancellation_reason'].trim()
          ? r['cancellation_reason'].trim()
          : null,
      created_at: typeof r['created_at'] === 'string' ? r['created_at'] : '',
      updated_at: typeof r['updated_at'] === 'string' ? r['updated_at'] : '',
      locations,
      pickup_task_locations: locations,
      courier_name: courierName,
    };
  }

  /**
   * Server-side delivered analytics (summary + city + courier).
   * Requires admin_delivered_analytics RPC migration applied in Supabase.
   */
  async getDeliveredAnalytics(
    filters: AdminDeliveredAnalyticsFilters,
  ): Promise<{ data: AdminDeliveredAnalytics; error: string | null }> {
    const payment =
      filters.paymentMethod === 'cash' || filters.paymentMethod === 'card'
        ? filters.paymentMethod
        : null;
    const courierRaw = filters.courierId?.trim() || null;

    const { data, error } = await this.supabase.client.rpc('admin_delivered_analytics', {
      p_date_from: isIsoDateOnly(filters.dateFrom) ? filters.dateFrom!.trim() : null,
      p_date_to: isIsoDateOnly(filters.dateTo) ? filters.dateTo!.trim() : null,
      p_city: filters.city?.trim() || null,
      p_courier_id: courierRaw,
      p_payment_method: payment,
    });

    if (error) {
      this.logSupabaseError('getDeliveredAnalytics', error);
      return { data: emptyDeliveredAnalytics(), error: error.message };
    }

    return { data: this.normalizeDeliveredAnalytics(data), error: null };
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

    if (filters.customerUserId?.trim() && order.user_id !== filters.customerUserId.trim()) {
      return false;
    }

    const customerType = this.normalizeCustomerType(filters.customerType);
    if (customerType === 'company' || customerType === 'individual') {
      const company = isCompanyCustomer(order.sender_name, order.owner_name);
      if (customerType === 'company' && !company) return false;
      if (customerType === 'individual' && company) return false;
    }

    if (filters.statusGroup === 'delivered') {
      if (!this.matchesDeliveryDateRange(order, filters.deliveredDateFrom, filters.deliveredDateTo)) {
        return false;
      }
    } else if (filters.date?.trim() && order.delivery_date !== filters.date.trim()) {
      return false;
    }

    const courierId = filters.courierId?.trim();
    if (courierId === ADMIN_COURIER_UNASSIGNED) {
      if (order.assigned_courier_id != null) return false;
    } else if (courierId && order.assigned_courier_id !== courierId) {
      return false;
    }

    const payment = filters.paymentMethod;
    if ((payment === 'cash' || payment === 'card') && order.payment_method !== payment) {
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
        order.owner_name,
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

  private matchesDeliveryDateRange(
    order: Order,
    fromDate?: string | null,
    toDate?: string | null,
  ): boolean {
    const from = fromDate?.trim();
    const to = toDate?.trim();
    if (!isIsoDateOnly(from) && !isIsoDateOnly(to)) return true;

    const deliveryDate = order.delivery_date?.trim() ?? '';
    if (!isIsoDateOnly(deliveryDate)) return false;

    if (isIsoDateOnly(from) && deliveryDate < from!) return false;
    if (isIsoDateOnly(to) && deliveryDate > to!) return false;
    return true;
  }

  private normalizeDeliveredAnalytics(raw: unknown): AdminDeliveredAnalytics {
    const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const summaryRaw = (root['summary'] && typeof root['summary'] === 'object'
      ? root['summary']
      : {}) as Record<string, unknown>;

    const byCity = Array.isArray(root['by_city']) ? root['by_city'] : [];
    const byCourier = Array.isArray(root['by_courier']) ? root['by_courier'] : [];

    return {
      summary: {
        order_count: asNumber(summaryRaw['order_count']),
        parcel_count: asNumber(summaryRaw['parcel_count']),
        total_amount: asNumber(summaryRaw['total_amount']),
        cash_amount: asNumber(summaryRaw['cash_amount']),
        card_amount: asNumber(summaryRaw['card_amount']),
      },
      by_city: byCity.map((row) => {
        const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
        return {
          city: typeof r['city'] === 'string' ? r['city'] : '—',
          order_count: asNumber(r['order_count']),
          parcel_count: asNumber(r['parcel_count']),
          total_amount: asNumber(r['total_amount']),
          cash_amount: asNumber(r['cash_amount']),
          card_amount: asNumber(r['card_amount']),
        };
      }),
      by_courier: byCourier.map((row) => {
        const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
        return {
          courier_id: typeof r['courier_id'] === 'string' ? r['courier_id'] : null,
          full_name: typeof r['full_name'] === 'string' ? r['full_name'] : 'მიუნიჭებელი',
          order_count: asNumber(r['order_count']),
          parcel_count: asNumber(r['parcel_count']),
          total_amount: asNumber(r['total_amount']),
          cash_amount: asNumber(r['cash_amount']),
          card_amount: asNumber(r['card_amount']),
        };
      }),
    };
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

    const [enriched] = await this.enrichOrdersWithOwners([
      normalizeOrder(data as unknown as Order)!,
    ]);
    return { data: enriched ?? null, error: null };
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

  /** Permanently delete one order (admin RLS). Cascades status audit rows. */
  async deleteOrder(orderId: number): Promise<{ error: string | null }> {
    if (!Number.isFinite(orderId)) {
      return { error: 'არასწორი შეკვეთის ID' };
    }

    const { error } = await this.supabase.client.from('orders').delete().eq('id', orderId);

    if (error) {
      this.logSupabaseError('deleteOrder', error);
      return { error: error.message };
    }

    return { error: null };
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
    };

    // Assign keeps current status (pending stays pending).
    // Unassign returns the order to the waiting pool.
    if (!courierId) {
      payload['status'] = 'pending';
    }

    const { data, error } = await this.supabase.client
      .from('orders')
      .update(payload)
      .in('id', uniqueIds)
      .select(ADMIN_ORDER_LIST_COLUMNS);

    if (error) {
      this.logSupabaseError('assignCouriersBulk', error);
      return { data: [], error: error.message };
    }

    return {
      data: await this.enrichOrdersWithOwners(normalizeOrders(data as unknown[])),
      error: null,
    };
  }

  /**
   * Lazy-load status history for one order (admin RLS). Newest first.
   * Does not fetch audits for the whole list.
   */
  async getOrderStatusAudit(
    orderId: number,
  ): Promise<{ data: OrderStatusAuditEntry[]; error: string | null }> {
    if (!Number.isFinite(orderId)) {
      return { data: [], error: 'არასწორი შეკვეთის ID' };
    }

    const { data, error } = await this.supabase.client
      .from('order_status_audit')
      .select(
        'id, order_id, changed_by, changed_by_role, old_status, new_status, source, changed_at, actor:profiles!order_status_audit_changed_by_fkey(full_name)',
      )
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST200' || error.message?.includes('Could not find')) {
        return this.getOrderStatusAuditFallback(orderId);
      }
      this.logSupabaseError('getOrderStatusAudit', error);
      return { data: [], error: error.message };
    }

    return { data: this.mapAuditRows(data as unknown[]), error: null };
  }

  private async getOrderStatusAuditFallback(
    orderId: number,
  ): Promise<{ data: OrderStatusAuditEntry[]; error: string | null }> {
    const { data, error } = await this.supabase.client
      .from('order_status_audit')
      .select(
        'id, order_id, changed_by, changed_by_role, old_status, new_status, source, changed_at',
      )
      .eq('order_id', orderId)
      .order('changed_at', { ascending: false });

    if (error) {
      this.logSupabaseError('getOrderStatusAuditFallback', error);
      return { data: [], error: error.message };
    }

    const rows = (data ?? []) as Array<{
      id: number;
      order_id: number;
      changed_by: string | null;
      changed_by_role: string | null;
      old_status: string | null;
      new_status: string;
      source: string | null;
      changed_at: string;
    }>;

    const actorIds = [
      ...new Set(rows.map((r) => r.changed_by).filter((id): id is string => Boolean(id))),
    ];

    let nameById = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles, error: profileError } = await this.supabase.client
        .from('profiles')
        .select('id, full_name')
        .in('id', actorIds);

      if (profileError) {
        this.logSupabaseError('getOrderStatusAuditFallback.profiles', profileError);
      } else {
        nameById = new Map(
          (profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]),
        );
      }
    }

    return {
      data: rows.map((row) => ({
        id: Number(row.id),
        order_id: Number(row.order_id),
        changed_by: row.changed_by,
        changed_by_role: row.changed_by_role,
        old_status: normalizeLegacyStatus(row.old_status) ?? row.old_status,
        new_status: normalizeLegacyStatus(row.new_status) ?? row.new_status,
        source: row.source,
        changed_at: row.changed_at,
        actor_name: row.changed_by ? (nameById.get(row.changed_by) ?? null) : null,
      })),
      error: null,
    };
  }

  private mapAuditRows(rows: unknown[] | null | undefined): OrderStatusAuditEntry[] {
    if (!rows?.length) {
      return [];
    }

    return rows.map((raw) => {
      const row = raw as {
        id: number | string;
        order_id: number | string;
        changed_by: string | null;
        changed_by_role: string | null;
        old_status: string | null;
        new_status: string;
        source: string | null;
        changed_at: string;
        actor?: { full_name?: string } | { full_name?: string }[] | null;
      };

      const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;

      return {
        id: Number(row.id),
        order_id: Number(row.order_id),
        changed_by: row.changed_by,
        changed_by_role: row.changed_by_role,
        old_status: normalizeLegacyStatus(row.old_status) ?? row.old_status,
        new_status: normalizeLegacyStatus(row.new_status) ?? row.new_status,
        source: row.source,
        changed_at: row.changed_at,
        actor_name: actor?.full_name?.trim() || null,
      };
    });
  }

  private applyStatusGroup(query: any, group: AdminStatusGroup) {
    switch (group) {
      case 'pending':
        return query.eq('status', 'pending');
      case 'active':
        return query.in('status', [...ADMIN_ACTIVE_STATUS_FILTER]);
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
    if (!isDevMode()) {
      return;
    }
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
      pickedUpOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
    };
  }
}
