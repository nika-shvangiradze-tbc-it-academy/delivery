import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Order, PaymentMethod, PickupTask, PickupTaskLocation } from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import {
  buildTelHref,
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  orderStatusClass,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-orders',
  imports: [DatePipe, CdkDropList, CdkDrag, CdkDragHandle],
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

  readonly statusClass = orderStatusClass;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly statusLabel = courierStatusLabel;

  /** Template alias — delivery queue only. */
  readonly orders = this.deliveryOrders;

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
    await this.loadDeliveryOrdersAndSummary();
  }

  async loadPickupTasks(): Promise<void> {
    this.pickupLoading.set(true);
    try {
      const { data, error } = await this.courierService.getMyPickupTasks();
      const tasks = data ?? [];

      console.log('[Pickup] before signal set:', tasks);

      // Assign into pickupTasks only — never into deliveryOrders/orders.
      this.pickupTasks.set(tasks);

      console.log('[Pickup] signal after set:', this.pickupTasks());

      if (error) {
        console.error('[CourierOrders] loadPickupTasks error', error);
        this.errorMessage.set(error);
      }
    } catch (err) {
      console.error('[CourierOrders] loadPickupTasks threw', err);
      const message = err instanceof Error ? err.message : 'Pickup tasks load failed';
      this.errorMessage.set(message);
      console.log('[Pickup] before signal set:', []);
      this.pickupTasks.set([]);
      console.log('[Pickup] signal after set:', this.pickupTasks());
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
      console.error('[Pickup] realtime: no session user');
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
          console.log('[Pickup] realtime INSERT → reload');
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
          console.log('[Pickup] realtime UPDATE → reload');
          this.zone.run(() => {
            void this.loadPickupTasks();
          });
        },
      )
      .subscribe((status) => {
        console.log('[Pickup] realtime status', status);
      });
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

    this.successMessage.set(`აღება შესრულებულია — ${updated} შეკვეთა`);
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
      this.pickupCancelError.set('გთხოვთ მიუთითოთ გაუქმების მიზეზი');
      return;
    }

    this.cancellingPickupId.set(task.id);
    this.pickupCancelError.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { success, error } = await this.courierService.cancelPickup(task.id, reason);
    this.cancellingPickupId.set(null);

    if (error || !success) {
      this.pickupCancelError.set(error ?? 'აღების გაუქმება ვერ მოხერხდა');
      return;
    }

    this.pickupCancelTask.set(null);
    this.pickupCancelReason.set('');
    this.successMessage.set('აღების დავალება გაუქმებულია');
    await Promise.all([this.loadPickupTasks(), this.loadDeliveryOrdersAndSummary()]);
  }

  toggleDetails(orderId: number): void {
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

  async onDrop(event: CdkDragDrop<Order[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const previous = [...this.deliveryOrders()];
    const next = [...previous];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.deliveryOrders.set(next);

    this.reordering.set(true);
    this.errorMessage.set(null);

    const { error } = await this.courierService.reorderActiveOrders(next.map((o) => o.id));
    this.reordering.set(false);

    if (error) {
      this.deliveryOrders.set(previous);
      this.errorMessage.set(error);
      return;
    }

    this.deliveryOrders.set(
      next.map((order, index) => ({
        ...order,
        courier_sort_order: (index + 1) * 10,
      })),
    );
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
        this.errorMessage.set(error ?? 'აღება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.deliveryOrders.update((list) =>
        list.map((item) => (item.id === order.id ? { ...item, ...data } : item)),
      );
      this.successMessage.set('შეკვეთა აღებულია');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`აღება ვერ მოხერხდა: ${message}`);
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
      this.errorMessage.set('აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.');
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
        this.errorMessage.set(error ?? 'ჩაბარება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.removeFromActive(order.id);
      this.successMessage.set('შეკვეთა ჩაბარდა');
      await this.refreshSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`ჩაბარება ვერ მოხერხდა: ${message}`);
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
      this.cancelReasonError.set('გთხოვთ მიუთითოთ გაუქმების მიზეზი');
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
        this.errorMessage.set(error ?? 'გაუქმება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.confirmingCancelId.set(null);
      this.cancelReasonDraft.set('');
      this.cancelReasonError.set(null);
      this.removeFromActive(order.id);
      this.successMessage.set('შეკვეთა გაუქმდა');
      await this.refreshSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`გაუქმება ვერ მოხერხდა: ${message}`);
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
