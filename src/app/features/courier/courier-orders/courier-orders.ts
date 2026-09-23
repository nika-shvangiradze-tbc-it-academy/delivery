import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import i18next from 'i18next';
import { DatePipe } from '@angular/common';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Order, PaymentMethod, PickupTask, PickupTaskLocation } from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import {
  buildTelHref,
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  orderStatusClass,
} from '../../../core/utils/order-status.util';
import { tbilisiTodayIso } from '../../../core/utils/tbilisi-time.util';

const VIEW_MODE_KEY = 'courier.activeOrders.viewMode';
const BIG_AMOUNT_GEL = 100;

export type CourierOrdersViewMode = 'compact' | 'classic';
export type CourierOrdersListMode = 'browse' | 'sort';
export type CourierOrdersQuickFilter = 'all' | 'today' | 'big_amount' | 'fragile';

function readStoredViewMode(): CourierOrdersViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    if (raw === 'classic' || raw === 'compact') return raw;
  } catch {
    // ignore
  }
  return 'compact';
}

@Component({
  selector: 'app-courier-orders',
  imports: [DatePipe, CdkDropList, CdkDrag, CdkDragHandle, TranslatePipe],
  templateUrl: './courier-orders.html',
  styleUrl: './courier-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierOrders implements OnInit, OnDestroy {
  private readonly courierService = inject(CourierService);
  private readonly realtime = inject(CourierRealtimeService);
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  /** Delivery orders only — never mixed with pickup tasks. */
  readonly deliveryOrders = signal<Order[]>([]);
  /** Pickup tasks from pickup_tasks table only. */
  readonly pickupTasks = signal<PickupTask[]>([]);
  readonly loading = signal(true);
  readonly pickupLoading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly completingPickupId = signal<number | null>(null);
  readonly cancellingPickupId = signal<number | null>(null);
  readonly pickupCancelTask = signal<PickupTask | null>(null);
  readonly pickupCancelReason = signal('');
  readonly pickupCancelError = signal<string | null>(null);
  readonly reordering = signal(false);
  /** Order id whose position badge is currently an editable input. */
  readonly editingPositionId = signal<number | null>(null);
  readonly positionDraft = signal('');
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  /** Only one order card details panel open at a time. */
  readonly expandedId = signal<number | null>(null);
  readonly confirmingCancelId = signal<number | null>(null);
  readonly cancelReasonDraft = signal('');
  readonly cancelReasonError = signal<string | null>(null);
  readonly paymentDrafts = signal<Record<number, PaymentMethod | null>>({});
  readonly summary = signal({
    cashTotal: '0.00',
    cardTotal: '0.00',
    grandTotal: '0.00',
    deliveredCount: 0,
  });

  /** compact = dense mobile rows; classic = previous card layout (rollback). */
  readonly viewMode = signal<CourierOrdersViewMode>(readStoredViewMode());
  /** browse = normal; sort = multi-select reorder mode. */
  readonly listMode = signal<CourierOrdersListMode>('browse');
  readonly quickFilter = signal<CourierOrdersQuickFilter>('all');
  readonly selectedSortIds = signal<Set<number>>(new Set());
  /** Skip soft realtime reloads briefly after a successful reorder (avoid list flicker). */
  private reorderQuietUntil = 0;

  readonly statusClass = orderStatusClass;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly statusLabel = courierStatusLabel;

  /** Template alias — delivery queue only (full unfiltered list for persistence). */
  readonly orders = this.deliveryOrders;

  /** Visible rows after quick filter (reorder still uses full deliveryOrders). */
  readonly displayOrders = computed(() => {
    const list = this.deliveryOrders();
    const filter = this.quickFilter();
    if (filter === 'all') return list;
    const today = tbilisiTodayIso();
    return list.filter((order) => {
      if (filter === 'today') {
        return (order.delivery_date ?? '').trim() === today;
      }
      if (filter === 'big_amount') {
        return Number(order.amount_to_collect) >= BIG_AMOUNT_GEL;
      }
      if (filter === 'fragile') {
        return order.is_fragile;
      }
      return true;
    });
  });

  readonly positionById = computed(() => {
    const map = new Map<number, number>();
    this.deliveryOrders().forEach((order, index) => {
      map.set(order.id, index + 1);
    });
    return map;
  });

  readonly selectedSortCount = computed(() => this.selectedSortIds().size);
  readonly isCompact = computed(() => this.viewMode() === 'compact');
  readonly isSortMode = computed(() => this.listMode() === 'sort');
  readonly canDragReorder = computed(
    () => !this.reordering() && this.listMode() === 'browse' && this.quickFilter() === 'all',
  );

  private pickupChannel: RealtimeChannel | null = null;

  constructor() {
    // Delivery-order realtime: refresh delivery queue.
    // Also reload pickup tasks — OrderRealtimeService also listens to pickup_tasks
    // and emits on the same courierChanges$ stream.
    this.realtime.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.refreshDeliveryFromRealtime();
      void this.loadPickupTasks();
    });

    this.realtime.manualRefresh$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.reload();
    });
  }

  async ngOnInit(): Promise<void> {
    // Wait for auth bootstrap so JWT is attached to Supabase REST calls.
    await this.auth.whenReady();

    // Load pickup tasks immediately and independently from delivery orders.
    void this.loadPickupTasks();
    void this.loadDeliveryOrdersAndSummary();
    await this.subscribePickupTasksRealtime();
  }

  ngOnDestroy(): void {
    this.teardownPickupChannel();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    await Promise.all([this.loadPickupTasks(), this.loadDeliveryOrdersAndSummary()]);
    this.loading.set(false);
  }

  /** Soft refresh for delivery queue only (orders realtime). */
  private async refreshDeliveryFromRealtime(): Promise<void> {
    if (this.savingId() !== null || this.reordering() || this.completingPickupId()) {
      return;
    }
    if (Date.now() < this.reorderQuietUntil) {
      return;
    }
    await this.loadDeliveryOrdersAndSummary();
  }

  async loadPickupTasks(): Promise<void> {
    this.pickupLoading.set(true);
    try {
      const { data, error } = await this.courierService.getMyPickupTasks();
      const tasks = data ?? [];

      // Assign into pickupTasks only — never into deliveryOrders/orders.
      this.pickupTasks.set(tasks);

      if (error) {
        this.errorMessage.set(error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pickup tasks load failed';
      this.errorMessage.set(message);
      this.pickupTasks.set([]);
    } finally {
      this.pickupLoading.set(false);
    }
  }

  private async loadDeliveryOrdersAndSummary(): Promise<void> {
    this.loading.set(true);
    const [ordersResult, summaryResult] = await Promise.all([
      this.courierService.getMyActiveOrders(),
      this.courierService.getTodayDeliveredSummary(),
    ]);

    this.deliveryOrders.set(ordersResult.data);
    this.summary.set(summaryResult.data);
    this.syncPaymentDrafts(ordersResult.data);

    const expanded = this.expandedId();
    if (expanded !== null && !ordersResult.data.some((o) => o.id === expanded)) {
      this.expandedId.set(null);
      this.confirmingCancelId.set(null);
    }

    const nextError = ordersResult.error ?? summaryResult.error;
    if (nextError) {
      this.errorMessage.set(nextError);
    }
    this.loading.set(false);
  }

  private async subscribePickupTasksRealtime(): Promise<void> {
    this.teardownPickupChannel();

    await this.auth.whenReady();
    const { data: sessionData } = await this.supabase.client.auth.getSession();
    const userId = sessionData.session?.user?.id ?? this.auth.user()?.id ?? null;
    if (!userId) {
      return;
    }

    // Dedicated channel — do not rely on delivery-order realtime alone.
    this.pickupChannel = this.supabase.client
      .channel(`courier-pickup-tasks-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pickup_tasks',
          filter: `assigned_courier_id=eq.${userId}`,
        },
        () => {
          this.zone.run(() => {
            void this.loadPickupTasks();
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pickup_tasks',
          filter: `assigned_courier_id=eq.${userId}`,
        },
        () => {
          this.zone.run(() => {
            void this.loadPickupTasks();
          });
        },
      )
      .subscribe();
  }

  private teardownPickupChannel(): void {
    if (this.pickupChannel) {
      void this.supabase.client.removeChannel(this.pickupChannel);
      this.pickupChannel = null;
    }
  }

  pickupAddressLine(task: PickupTask): string {
    return [task.pickup_city, task.pickup_district, task.pickup_address]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }

  locationLabel(loc: PickupTaskLocation): string {
    return [loc.city, loc.district, loc.address]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ') || '—';
  }

  async completePickupTask(task: PickupTask): Promise<void> {
    this.completingPickupId.set(task.id);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { updated, error } = await this.courierService.completePickup(task.id);
    this.completingPickupId.set(null);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    this.successMessage.set(i18next.t('courier.pickupCompletedCount', { count: updated }));
    await Promise.all([this.loadPickupTasks(), this.loadDeliveryOrdersAndSummary()]);
  }

  openPickupCancel(task: PickupTask): void {
    this.pickupCancelTask.set(task);
    this.pickupCancelReason.set('');
    this.pickupCancelError.set(null);
  }

  closePickupCancel(): void {
    if (this.cancellingPickupId() != null) return;
    this.pickupCancelTask.set(null);
    this.pickupCancelReason.set('');
    this.pickupCancelError.set(null);
  }

  async confirmPickupCancel(): Promise<void> {
    const task = this.pickupCancelTask();
    if (!task) return;

    const reason = this.pickupCancelReason().trim();
    if (!reason) {
      this.pickupCancelError.set(i18next.t('courier.pickupCancelReasonRequired'));
      return;
    }

    this.cancellingPickupId.set(task.id);
    this.pickupCancelError.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { success, error } = await this.courierService.cancelPickup(task.id, reason);
    this.cancellingPickupId.set(null);

    if (error || !success) {
      this.pickupCancelError.set(error ?? i18next.t('courier.pickupCancelFailed'));
      return;
    }

    this.pickupCancelTask.set(null);
    this.pickupCancelReason.set('');
    this.successMessage.set(i18next.t('courier.pickupCancelledSuccess'));
    await Promise.all([this.loadPickupTasks(), this.loadDeliveryOrdersAndSummary()]);
  }

  toggleDetails(orderId: number): void {
    if (this.isSortMode()) {
      return;
    }
    this.expandedId.update((current) => (current === orderId ? null : orderId));
    if (this.confirmingCancelId() === orderId) {
      this.confirmingCancelId.set(null);
    }
  }

  closeDetails(): void {
    const id = this.expandedId();
    this.expandedId.set(null);
    if (id !== null && this.confirmingCancelId() === id) {
      this.confirmingCancelId.set(null);
    }
  }

  isExpanded(orderId: number): boolean {
    return this.expandedId() === orderId;
  }

  telHref(phone: string): string {
    return buildTelHref(phone);
  }

  selectedPayment(orderId: number): PaymentMethod | null {
    return this.paymentDrafts()[orderId] ?? null;
  }

  selectPayment(orderId: number, payment: PaymentMethod): void {
    this.paymentDrafts.update((current) => ({
      ...current,
      [orderId]: payment,
    }));
    this.errorMessage.set(null);
  }

  setViewMode(mode: CourierOrdersViewMode): void {
    this.viewMode.set(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
    if (mode === 'classic') {
      this.exitSortMode();
    }
  }

  setQuickFilter(filter: CourierOrdersQuickFilter): void {
    this.quickFilter.set(filter);
    if (filter !== 'all' && this.listMode() === 'sort') {
      // Keep selection but drag is disabled when filtered.
    }
  }

  enterSortMode(): void {
    this.listMode.set('sort');
    this.selectedSortIds.set(new Set());
    this.expandedId.set(null);
    this.confirmingCancelId.set(null);
  }

  exitSortMode(): void {
    this.listMode.set('browse');
    this.selectedSortIds.set(new Set());
  }

  toggleSortSelected(orderId: number, checked: boolean): void {
    this.selectedSortIds.update((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  isSortSelected(orderId: number): boolean {
    return this.selectedSortIds().has(orderId);
  }

  orderPosition(orderId: number): number {
    return this.positionById().get(orderId) ?? 0;
  }

  canEditPosition(): boolean {
    return !this.reordering() && !this.isSortMode();
  }

  startPositionEdit(orderId: number, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.canEditPosition()) return;

    this.editingPositionId.set(orderId);
    this.positionDraft.set(String(this.orderPosition(orderId)));
    this.errorMessage.set(null);

    queueMicrotask(() => {
      const el = document.getElementById(`pos-edit-${orderId}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  cancelPositionEdit(): void {
    this.editingPositionId.set(null);
    this.positionDraft.set('');
  }

  onPositionDraftInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.positionDraft.set(value);
  }

  async confirmPositionEdit(orderId: number, event?: Event): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();

    // Ignore stale blur after Enter already cleared the editor.
    if (this.editingPositionId() !== orderId) return;

    const raw = this.positionDraft().trim();
    this.cancelPositionEdit();

    const max = this.deliveryOrders().length;
    const parsed = Number(raw);
    const valid =
      raw !== '' &&
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= 1 &&
      parsed <= max;

    if (!valid) {
      this.errorMessage.set(i18next.t('courier.invalidPosition'));
      this.successMessage.set(null);
      return;
    }

    if (parsed === this.orderPosition(orderId)) return;

    const ok = await this.moveOrderToPosition(orderId, parsed);
    if (ok) {
      this.successMessage.set(i18next.t('courier.movedToPosition', { pos: parsed }));
      this.errorMessage.set(null);
    }
  }

  /**
   * Central insertion reorder: move orderId to 1-based targetPosition,
   * shifting others. Used by drag & drop, ↑1, and numeric position edit.
   */
  async moveOrderToPosition(orderId: number, targetPosition: number): Promise<boolean> {
    if (this.reordering()) return false;

    const previous = [...this.deliveryOrders()];
    const from = previous.findIndex((o) => o.id === orderId);
    if (from < 0) return false;

    const max = previous.length;
    if (
      !Number.isInteger(targetPosition) ||
      targetPosition < 1 ||
      targetPosition > max
    ) {
      this.errorMessage.set(i18next.t('courier.invalidPosition'));
      this.successMessage.set(null);
      return false;
    }

    const to = targetPosition - 1;
    if (from === to) return true;

    const next = [...previous];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);

    return this.persistOrderIds(
      next.map((o) => o.id),
      previous,
    );
  }

  async moveToFront(orderId: number, event?: Event): Promise<void> {
    event?.stopPropagation();
    await this.moveOrderToPosition(orderId, 1);
  }

  async moveSelectedToFront(): Promise<void> {
    if (this.reordering()) return;
    const selected = this.selectedSortIds();
    if (selected.size === 0) return;

    const current = this.deliveryOrders();
    const selectedOrders = current.filter((o) => selected.has(o.id));
    const rest = current.filter((o) => !selected.has(o.id));
    // Multi-select "to front" is still insertion of the selected block at position 1.
    const ok = await this.persistOrderIds(
      [...selectedOrders, ...rest].map((o) => o.id),
      current,
    );
    if (ok) {
      this.exitSortMode();
    }
  }

  async onDrop(event: CdkDragDrop<Order[]>): Promise<void> {
    if (!this.canDragReorder()) return;
    if (event.previousIndex === event.currentIndex) return;

    const order = this.deliveryOrders()[event.previousIndex];
    if (!order) return;
    await this.moveOrderToPosition(order.id, event.currentIndex + 1);
  }

  /**
   * Persist full delivery queue order via existing courier_reorder_orders RPC.
   * Keeps local list order — does not reload from backend after success.
   */
  private async persistOrderIds(
    orderIds: number[],
    previousOrders: Order[],
  ): Promise<boolean> {
    const byId = new Map(previousOrders.map((o) => [o.id, o] as const));
    const next = orderIds
      .map((id) => byId.get(id))
      .filter((o): o is Order => Boolean(o));

    if (next.length !== previousOrders.length) {
      this.errorMessage.set(i18next.t('courier.reorderSaveFailed'));
      return false;
    }

    this.deliveryOrders.set(next);
    this.reordering.set(true);
    this.errorMessage.set(null);

    const { error } = await this.courierService.reorderActiveOrders(orderIds);
    this.reordering.set(false);

    if (error) {
      this.deliveryOrders.set(previousOrders);
      this.errorMessage.set(error);
      return false;
    }

    // Quiet realtime soft-reloads so the list is not fetched again and reshuffled.
    this.reorderQuietUntil = Date.now() + 4000;

    this.deliveryOrders.set(
      next.map((order, index) => ({
        ...order,
        courier_sort_order: (index + 1) * 10,
      })),
    );
    return true;
  }

  async markPickedUp(order: Order): Promise<void> {
    this.savingId.set(order.id);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.confirmingCancelId.set(null);

    try {
      const { data, error } = await this.courierService.changeOrderStatus(
        order.id,
        'picked_up',
        null,
        order.assigned_courier_id,
      );

      if (error || !data) {
        this.errorMessage.set(error ?? i18next.t('courier.pickupFailed'));
        if (error?.includes(i18next.t('ui.sessionExpired')) || error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.deliveryOrders.update((list) =>
        list.map((item) => (item.id === order.id ? { ...item, ...data } : item)),
      );
      this.successMessage.set(i18next.t('courier.orderPickedUp'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.pickupFailedWithReason', { message }));
    } finally {
      this.savingId.set(null);
    }
  }

  canMarkPickedUp(order: Order): boolean {
    // Delivery take from office (or legacy pending if assigned without pickup).
    return order.status === 'office' || order.status === 'pending';
  }

  async markDelivered(order: Order): Promise<void> {
    const payment = this.selectedPayment(order.id);
    if (!payment) {
      this.errorMessage.set(i18next.t('courier.paymentRequired'));
      this.successMessage.set(null);
      if (!this.isExpanded(order.id)) {
        this.toggleDetails(order.id);
      }
      return;
    }

    this.savingId.set(order.id);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.confirmingCancelId.set(null);

    try {
      const { data, error } = await this.courierService.completeOrder(
        order.id,
        payment,
        order.assigned_courier_id,
      );

      if (error || !data) {
        this.errorMessage.set(error ?? i18next.t('courier.deliverFailed'));
        if (error?.includes(i18next.t('ui.sessionExpired')) || error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.removeFromActive(order.id);
      this.successMessage.set(i18next.t('courier.orderDelivered'));
      await this.refreshSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.deliverFailedWithReason', { message }));
    } finally {
      this.savingId.set(null);
    }
  }

  requestCancel(order: Order): void {
    this.confirmingCancelId.set(order.id);
    this.cancelReasonDraft.set('');
    this.cancelReasonError.set(null);
    this.errorMessage.set(null);
  }

  dismissCancel(): void {
    this.confirmingCancelId.set(null);
    this.cancelReasonDraft.set('');
    this.cancelReasonError.set(null);
  }

  onCancelReasonInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.cancelReasonDraft.set(value);
    this.errorMessage.set(null);
    if (value.trim()) {
      this.cancelReasonError.set(null);
    }
  }

  async confirmCancel(order: Order, reasonFromInput?: string): Promise<void> {
    const reason = [reasonFromInput, this.cancelReasonDraft()]
      .map((value) => String(value ?? '').trim())
      .find((value) => value.length > 0) ?? '';
    if (!reason) {
      this.cancelReasonError.set(i18next.t('courier.pickupCancelReasonRequired'));
      this.errorMessage.set(null);
      return;
    }

    if (this.savingId() === order.id) {
      return;
    }

    this.cancelReasonDraft.set(reason);
    this.savingId.set(order.id);
    this.cancelReasonError.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.cancelOrder(
        order.id,
        reason,
        order.assigned_courier_id,
      );

      if (error || !data) {
        this.errorMessage.set(error ?? i18next.t('courier.cancelFailed'));
        if (error?.includes(i18next.t('ui.sessionExpired')) || error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.confirmingCancelId.set(null);
      this.cancelReasonDraft.set('');
      this.cancelReasonError.set(null);
      this.removeFromActive(order.id);
      this.successMessage.set(i18next.t('courier.orderCancelled'));
      await this.refreshSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.cancelFailedWithReason', { message }));
    } finally {
      this.savingId.set(null);
    }
  }

  private removeFromActive(orderId: number): void {
    this.deliveryOrders.update((list) => list.filter((item) => item.id !== orderId));
    this.paymentDrafts.update((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
    this.expandedId.update((current) => (current === orderId ? null : current));
  }

  private async refreshSummary(): Promise<void> {
    const summaryResult = await this.courierService.getTodayDeliveredSummary();
    if (!summaryResult.error) {
      this.summary.set(summaryResult.data);
    }
  }

  private syncPaymentDrafts(orders: Order[]): void {
    const next: Record<number, PaymentMethod | null> = {};
    for (const order of orders) {
      next[order.id] = order.payment_method;
    }
    this.paymentDrafts.set(next);
  }
}
