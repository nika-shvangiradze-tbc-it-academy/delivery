import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import {
  COURIER_ALLOWED_STATUSES,
  CourierDailySummary,
  CourierStatus,
  Order,
  PaymentMethod,
} from '../../../core/models/order.model';
import { CourierService } from '../../../core/services/courier.service';
import {
  buildMapsUrl,
  buildTelHref,
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  orderStatusClass,
  paymentMethodLabel,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-orders',
  imports: [FormsModule, DatePipe, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './courier-orders.html',
  styleUrl: './courier-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierOrders implements OnInit {
  private readonly courierService = inject(CourierService);
  private readonly router = inject(Router);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly reordering = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly showSummary = signal(false);
  readonly expandedIds = signal<ReadonlySet<number>>(new Set());
  readonly summary = signal<CourierDailySummary>({
    cashTotal: '0.00',
    cardTotal: '0.00',
    grandTotal: '0.00',
    deliveredCount: 0,
  });

  readonly drafts = signal<
    Record<
      number,
      { status: CourierStatus; payment_method: PaymentMethod | null; collected_amount: string }
    >
  >({});

  readonly allowedStatuses = COURIER_ALLOWED_STATUSES;
  readonly statusClass = orderStatusClass;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly statusLabel = courierStatusLabel;
  readonly paymentLabel = paymentMethodLabel;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const [ordersResult, summaryResult] = await Promise.all([
      this.courierService.getMyActiveOrders(),
      this.courierService.getTodayDeliveredSummary(),
    ]);

    this.orders.set(ordersResult.data);
    this.summary.set(summaryResult.data);
    this.syncDrafts(ordersResult.data);

    this.errorMessage.set(ordersResult.error ?? summaryResult.error);
    this.loading.set(false);
  }

  toggleSummary(): void {
    this.showSummary.update((v) => !v);
  }

  toggleDetails(orderId: number): void {
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  isExpanded(orderId: number): boolean {
    return this.expandedIds().has(orderId);
  }

  telHref(phone: string): string {
    return buildTelHref(phone);
  }

  mapsUrl(order: Order): string {
    return buildMapsUrl(order);
  }

  onDraftStatus(orderId: number, status: CourierStatus): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: { ...current[orderId], status },
    }));
  }

  onDraftPayment(orderId: number, payment: PaymentMethod | null): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: {
        ...current[orderId],
        payment_method: payment,
      },
    }));
  }

  onDraftAmount(orderId: number, amount: string): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: { ...current[orderId], collected_amount: amount },
    }));
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

  async markDelivered(order: Order): Promise<void> {
    this.onDraftStatus(order.id, 'delivered');
    await this.saveOrder(order);
  }

  async saveOrder(order: Order): Promise<void> {
    const draft = this.drafts()[order.id];
    if (!draft) {
      return;
    }

    this.savingId.set(order.id);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.updateAssignedOrder(
        order.id,
        {
          status: draft.status,
          payment_method: draft.payment_method,
          collected_amount: draft.collected_amount,
        },
        order.assigned_courier_id,
      );

      if (error || !data) {
        console.error('CourierOrders.saveOrder failed:', error);
        this.errorMessage.set(`შენახვა ვერ მოხერხდა: ${error ?? 'Unknown error'}`);
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.errorMessage.set(null);
      this.successMessage.set('შეინახა');

      if (!this.courierService.isActiveStatus(data.status)) {
        this.orders.update((list) => list.filter((item) => item.id !== order.id));
        this.drafts.update((current) => {
          const next = { ...current };
          delete next[order.id];
          return next;
        });
        this.expandedIds.update((current) => {
          const next = new Set(current);
          next.delete(order.id);
          return next;
        });
      } else {
        this.orders.update((list) =>
          list.map((item) =>
            item.id === order.id
              ? {
                  ...item,
                  ...data,
                  status: data.status,
                  payment_method: data.payment_method,
                  collected_amount: data.collected_amount,
                }
              : item,
          ),
        );
        this.drafts.update((current) => ({
          ...current,
          [order.id]: {
            status: data.status as CourierStatus,
            payment_method: data.payment_method,
            collected_amount: formatGel(data.collected_amount),
          },
        }));
      }

      const summaryResult = await this.courierService.getTodayDeliveredSummary();
      if (!summaryResult.error) {
        this.summary.set(summaryResult.data);
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`შენახვა ვერ მოხერხდა: ${message}`);
    } finally {
      this.savingId.set(null);
    }
  }

  private syncDrafts(orders: Order[]): void {
    const nextDrafts: Record<
      number,
      { status: CourierStatus; payment_method: PaymentMethod | null; collected_amount: string }
    > = {};
    for (const order of orders) {
      const status: CourierStatus =
        order.status === 'pending' || !(COURIER_ALLOWED_STATUSES as string[]).includes(order.status)
          ? 'accepted'
          : (order.status as CourierStatus);
      nextDrafts[order.id] = {
        status,
        payment_method: order.payment_method,
        collected_amount: formatGel(order.collected_amount),
      };
    }
    this.drafts.set(nextDrafts);
  }
}
