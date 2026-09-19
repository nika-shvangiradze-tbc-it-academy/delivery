import { Injectable, inject, isDevMode } from '@angular/core';
import {
  COURIER_ACTIVE_STATUS_FILTER,
  COURIER_ACTIVE_STATUSES,
  COURIER_HISTORY_STATUSES,
  CourierDailySummary,
  CourierStatus,
  Order,
  OrderStatus,
  PaymentMethod,
  PickupTask,
  PickupTaskLocation,
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

/** Pickup tasks only — never joins delivery order columns. */
const PICKUP_TASKS_EMBED = `
  *,
  pickup_task_locations (
    id,
    city,
    district,
    address,
    parcel_count
  )
`;

const PICKUP_TASKS_FLAT = '*';
const PICKUP_LOCATIONS_COLUMNS = 'id, pickup_task_id, city, district, address, parcel_count';

@Injectable({
  providedIn: 'root',
})
export class CourierService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async getMyActiveOrders(): Promise<{ data: Order[]; error: string | null }> {
    return this.getMyOrdersByStatuses([...COURIER_ACTIVE_STATUS_FILTER], 'active');
  }

  /**
   * Active pickup tasks for the logged-in courier.
   * Source of truth: pickup_tasks + pickup_task_locations (not orders).
   */
  async getMyPickupTasks(): Promise<{ data: PickupTask[]; error: string | null }> {
    await this.auth.whenReady();

    const { data: sessionData, error: sessionError } = await this.supabase.client.auth.getSession();
    if (sessionError) {
      console.error('[Pickup] session error', sessionError);
      return { data: [], error: sessionError.message };
    }

    const userId = sessionData.session?.user?.id ?? this.auth.user()?.id ?? null;
    console.log('[Pickup] USER ID', userId);

    if (!userId) {
      const message = 'No authenticated courier session';
      console.error('[Pickup]', message);
      return { data: [], error: message };
    }

    // Preferred: single embed query (as designed).
    const embedded = await this.supabase.client
      .from('pickup_tasks')
      .select(PICKUP_TASKS_EMBED)
      .eq('assigned_courier_id', userId)
      .in('status', ['assigned', 'picked_up', 'completed', 'cancelled'])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    console.log('[Pickup] Supabase data:', embedded.data);
    console.log('[Pickup] Supabase error:', embedded.error);

    if (!embedded.error) {
      const normalizedTasks = (embedded.data ?? [])
        .map((row) => this.normalizePickupTask(row))
        .filter((t): t is PickupTask => t !== null)
        .sort((a, b) => this.pickupStatusSortRank(a.status) - this.pickupStatusSortRank(b.status));
      console.log('[Pickup] normalized:', normalizedTasks);
      return { data: normalizedTasks, error: null };
    }

    // Do not hide embed failures — log, then try two-step fetch (no schema change).
    console.error('[Pickup] embed query failed, trying two-step fetch', embedded.error);

    const flat = await this.supabase.client
      .from('pickup_tasks')
      .select(PICKUP_TASKS_FLAT)
      .eq('assigned_courier_id', userId)
      .in('status', ['assigned', 'picked_up', 'completed', 'cancelled'])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    console.log('[Pickup] flat Supabase data:', flat.data);
    console.log('[Pickup] flat Supabase error:', flat.error);

    if (flat.error) {
      console.error('[Pickup] flat query failed', flat.error);
      return { data: [], error: flat.error.message };
    }

    const taskRows = flat.data ?? [];
    const taskIds = taskRows
      .map((row) => Number((row as { id?: number | string }).id))
      .filter((id) => Number.isFinite(id) && id > 0);

    let locationsByTask = new Map<number, unknown[]>();
    if (taskIds.length > 0) {
      const locs = await this.supabase.client
        .from('pickup_task_locations')
        .select(PICKUP_LOCATIONS_COLUMNS)
        .in('pickup_task_id', taskIds);

      console.log('[Pickup] locations Supabase data:', locs.data);
      console.log('[Pickup] locations Supabase error:', locs.error);

      if (locs.error) {
        console.error('[Pickup] locations query failed', locs.error);
        // Still return tasks; locations may be empty but cards must show.
      } else {
        locationsByTask = new Map();
        for (const loc of locs.data ?? []) {
          const taskId = Number((loc as { pickup_task_id?: number | string }).pickup_task_id);
          if (!Number.isFinite(taskId)) continue;
          const list = locationsByTask.get(taskId) ?? [];
          list.push(loc);
          locationsByTask.set(taskId, list);
        }
      }
    }

    const merged = taskRows.map((row) => {
      const id = Number((row as { id?: number | string }).id);
      return {
        ...(row as Record<string, unknown>),
        pickup_task_locations: locationsByTask.get(id) ?? [],
      };
    });

    const normalizedTasks = merged
      .map((row) => this.normalizePickupTask(row))
      .filter((t): t is PickupTask => t !== null)
      .sort((a, b) => this.pickupStatusSortRank(a.status) - this.pickupStatusSortRank(b.status));

    console.log('[Pickup] normalized:', normalizedTasks);
    return { data: normalizedTasks, error: null };
  }

  /**
   * Complete pickup via SECURITY DEFINER RPC only.
   * Does not PATCH orders — courier_complete_pickup updates linked pending → picked_up.
   */
  async completePickup(pickupTaskId: number): Promise<{ updated: number; error: string | null }> {
    if (!Number.isFinite(pickupTaskId) || pickupTaskId <= 0) {
      return { updated: 0, error: 'აღების დავალება არასწორია' };
    }

    const sessionCheck = await this.requireCourierSession(0);
    if (sessionCheck.error) {
      return { updated: 0, error: sessionCheck.error };
    }

    const { data, error } = await this.supabase.client.rpc('courier_complete_pickup', {
      p_pickup_task_id: pickupTaskId,
    });

    if (error) {
      this.logRpcError('courier_complete_pickup', error);
      return { updated: 0, error: this.mapCourierRpcError(error.message) };
    }

    const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const updated =
      typeof root['updated'] === 'number' ? root['updated'] : Number(root['updated'] ?? 0) || 0;
    return { updated, error: null };
  }

  /**
   * Cancel pickup via SECURITY DEFINER RPC only.
   * Updates pickup_tasks only — linked orders stay pending.
   */
  async cancelPickup(
    pickupTaskId: number,
    reason: string,
  ): Promise<{ success: boolean; error: string | null }> {
    if (!Number.isFinite(pickupTaskId) || pickupTaskId <= 0) {
      return { success: false, error: 'აღების დავალება არასწორია' };
    }
    const trimmed = reason.trim();
    if (!trimmed) {
      return { success: false, error: 'გთხოვთ მიუთითოთ გაუქმების მიზეზი' };
    }
    if (trimmed.length > 500) {
      return { success: false, error: 'მიზეზი ძალიან გრძელია (მაქს. 500 სიმბოლო)' };
    }

    const sessionCheck = await this.requireCourierSession(0);
    if (sessionCheck.error) {
      return { success: false, error: sessionCheck.error };
    }

    const { data, error } = await this.supabase.client.rpc('courier_cancel_pickup', {
      p_task_id: pickupTaskId,
      p_reason: trimmed,
    });

    if (error) {
      this.logRpcError('courier_cancel_pickup', error);
      return { success: false, error: this.mapCourierRpcError(error.message) };
    }

    const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const success = root['success'] === true || root['status'] === 'cancelled';
    return { success, error: success ? null : 'აღების გაუქმება ვერ მოხერხდა' };
  }

  private pickupStatusSortRank(status: PickupTask['status']): number {
    switch (status) {
      case 'assigned':
        return 0;
      case 'picked_up':
        return 1;
      case 'completed':
        return 2;
      case 'cancelled':
        return 3;
      default:
        return 9;
    }
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
        this.logDevError('Courier session check failed', sessionError);
        return { error: sessionError.message || 'Session check failed' };
      }

      if (!session?.user) {
        // Expected auth expiry — UI shows message / redirects to login.
        return { error: 'სესია არ არის აქტიური. გთხოვთ თავიდან შეხვიდეთ.' };
      }

      const userId = session.user.id;

      if (assignedCourierId && assignedCourierId !== userId) {
        // Expected authorization rejection — caller surfaces UI feedback.
        return { error: 'ამ შეკვეთის შეცვლის უფლება არ გაქვთ.' };
      }

      return { error: null };
    } catch (err) {
      this.logDevError('Courier session check unexpected error', err);
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
      this.logDevError(`${rpcName} returned empty data`, data);
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
    if (lower.includes('cancellation reason is too long')) {
      return 'მიზეზი ძალიან გრძელია (მაქს. 500 სიმბოლო)';
    }
    if (lower.includes('pickup task is not active') || lower.includes('not your pickup task')) {
      return 'აღების დავალება აღარ არის აქტიური.';
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
    this.logDevError(`${rpcName} failed`, {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
  }

  private logDevError(context: string, details?: unknown): void {
    if (!isDevMode()) {
      return;
    }
    if (details !== undefined) {
      console.error(`[CourierService] ${context}:`, details);
    } else {
      console.error(`[CourierService] ${context}`);
    }
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

  private normalizePickupTask(raw: unknown): PickupTask | null {
    if (!raw || typeof raw !== 'object') {
      console.error('[CourierService] normalizePickupTask: non-object row', raw);
      return null;
    }
    const r = raw as Record<string, unknown>;
    const id = Number(r['id']);
    if (!Number.isFinite(id) || id <= 0) {
      console.error('[CourierService] normalizePickupTask: invalid id', r['id'], raw);
      return null;
    }
    const statusRaw = r['status'];
    const normalizedStatus: PickupTask['status'] =
      statusRaw === 'cancelled'
        ? 'cancelled'
        : statusRaw === 'completed'
          ? 'completed'
          : statusRaw === 'picked_up'
            ? 'picked_up'
            : 'assigned';

    const locationsRaw = r['pickup_task_locations'] ?? r['locations'];
    let locations: PickupTaskLocation[] = [];
    if (Array.isArray(locationsRaw)) {
      locations = locationsRaw
        .map((loc) => this.normalizePickupTaskLocation(loc, id))
        .filter((loc): loc is PickupTaskLocation => loc !== null)
        .sort((a, b) => a.id - b.id);
    } else if (locationsRaw && typeof locationsRaw === 'object') {
      // PostgREST occasionally returns a single object for one-to-one mis-detect.
      const one = this.normalizePickupTaskLocation(locationsRaw, id);
      if (one) {
        locations = [one];
      }
    }
    // One customer = one pickup point — keep only the first location row.
    if (locations.length > 1) {
      locations = [locations[0]];
    }
    // Legacy single-address fallback when locations table is empty/missing
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
          parcel_count: Number(r['parcel_count'] ?? 0) || 0,
          created_at: typeof r['created_at'] === 'string' ? r['created_at'] : '',
        },
      ];
    }

    const courierEmbed = r['courier'] ?? r['profiles'];
    let courierName: string | null = null;
    if (courierEmbed && typeof courierEmbed === 'object' && !Array.isArray(courierEmbed)) {
      const name = (courierEmbed as Record<string, unknown>)['full_name'];
      if (typeof name === 'string' && name.trim()) {
        courierName = name.trim();
      }
    } else if (typeof r['courier_name'] === 'string' && r['courier_name'].trim()) {
      courierName = r['courier_name'].trim();
    }

    return {
      id,
      customer_id: String(r['customer_id'] ?? ''),
      assigned_courier_id: String(r['assigned_courier_id'] ?? ''),
      status: normalizedStatus,
      order_count: Number(r['order_count'] ?? 0) || 0,
      parcel_count: Number(r['parcel_count'] ?? 0) || 0,
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

  private normalizePickupTaskLocation(
    raw: unknown,
    fallbackTaskId: number,
  ): PickupTaskLocation | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const r = raw as Record<string, unknown>;
    const id = Number(r['id']);
    if (!Number.isFinite(id)) {
      return null;
    }
    return {
      id,
      pickup_task_id: Number(r['pickup_task_id'] ?? fallbackTaskId) || fallbackTaskId,
      city: typeof r['city'] === 'string' && r['city'].trim() ? r['city'].trim() : null,
      district:
        typeof r['district'] === 'string' && r['district'].trim() ? r['district'].trim() : null,
      address:
        typeof r['address'] === 'string' && r['address'].trim() ? r['address'].trim() : null,
      parcel_count: Number(r['parcel_count'] ?? 0) || 0,
      created_at: typeof r['created_at'] === 'string' ? r['created_at'] : '',
    };
  }
}
