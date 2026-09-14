import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import { Order, PaymentMethod } from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
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
export class CourierOrders implements OnInit {
  private readonly courierService = inject(CourierService);
  private readonly realtime = inject(CourierRealtimeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
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

  constructor() {
    this.realtime.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.refreshFromRealtime();
    });

    this.realtime.manualRefresh$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.reload();
    });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    await this.fetchOrdersAndSummary();
    this.loading.set(false);
  }

  /** Soft refresh from Realtime — no full-page loading flash. */
  private async refreshFromRealtime(): Promise<void> {
    if (this.savingId() !== null || this.reordering()) {
      return;
    }
    await this.fetchOrdersAndSummary();
  }

  private async fetchOrdersAndSummary(): Promise<void> {
    const [ordersResult, summaryResult] = await Promise.all([
      this.courierService.getMyActiveOrders(),
      this.courierService.getTodayDeliveredSummary(),
    ]);

    this.orders.set(ordersResult.data);
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

    const previous = [...this.orders()];
    const next = [...previous];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.orders.set(next);

    this.reordering.set(true);
    this.errorMessage.set(null);

    const { error } = await this.courierService.reorderActiveOrders(next.map((o) => o.id));
    this.reordering.set(false);

    if (error) {
      this.orders.set(previous);
      this.errorMessage.set(error);
      return;
    }

    this.orders.set(
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
        console.error('CourierOrders.markPickedUp failed:', error);
        this.errorMessage.set(error ?? 'აღება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.orders.update((list) =>
        list.map((item) => (item.id === order.id ? { ...item, ...data } : item)),
      );
      this.successMessage.set('შეკვეთა აღებულია');
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`აღება ვერ მოხერხდა: ${message}`);
    } finally {
      this.savingId.set(null);
    }
  }

  canMarkPickedUp(order: Order): boolean {
    return order.status === 'pending';
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
        console.error('CourierOrders.markDelivered failed:', error);
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
      console.error(err);
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
        console.error('CourierOrders.confirmCancel failed:', error);
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
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`გაუქმება ვერ მოხერხდა: ${message}`);
    } finally {
      this.savingId.set(null);
    }
  }

  private removeFromActive(orderId: number): void {
    this.orders.update((list) => list.filter((item) => item.id !== orderId));
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
