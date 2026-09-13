import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  COURIER_ALLOWED_STATUSES,
  CourierDailySummary,
  Order,
  OrderStatus,
  PaymentMethod,
} from '../../../core/models/order.model';
import { AuthService } from '../../../core/services/auth.service';
import { CourierService } from '../../../core/services/courier.service';
import {
  buildMapsUrl,
  buildTelHref,
  formatGel,
  orderStatusClass,
  orderStatusLabelKey,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-orders',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './courier-orders.html',
  styleUrl: './courier-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierOrders implements OnInit {
  private readonly courierService = inject(CourierService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly showSummary = signal(true);
  readonly summary = signal<CourierDailySummary>({
    cashTotal: '0.00',
    cardTotal: '0.00',
    grandTotal: '0.00',
    deliveredCount: 0,
  });

  readonly drafts = signal<
    Record<number, { status: OrderStatus; payment_method: PaymentMethod | null; collected_amount: string }>
  >({});

  readonly courierName = computed(() => this.auth.profile()?.full_name ?? 'კურიერი');
  readonly allowedStatuses = COURIER_ALLOWED_STATUSES;

  readonly statusClass = orderStatusClass;
  readonly statusLabel = (status: OrderStatus): string => {
    const map: Record<string, string> = {
      accepted: 'მინიჭებული',
      picked_up: 'აღებული',
      in_transit: 'გზაში',
      delivered: 'მიწოდებული',
      cancelled: 'გაუქმებული',
    };
    return map[status] ?? status;
  };

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const [ordersResult, summaryResult] = await Promise.all([
      this.courierService.getMyAssignedOrders(),
      this.courierService.getTodayDeliveredSummary(),
    ]);

    this.orders.set(ordersResult.data);
    this.summary.set(summaryResult.data);

    const nextDrafts: Record<
      number,
      { status: OrderStatus; payment_method: PaymentMethod | null; collected_amount: string }
    > = {};
    for (const order of ordersResult.data) {
      nextDrafts[order.id] = {
        status: order.status === 'pending' ? 'accepted' : order.status,
        payment_method: order.payment_method,
        collected_amount: formatGel(order.collected_amount),
      };
    }
    this.drafts.set(nextDrafts);

    this.errorMessage.set(ordersResult.error ?? summaryResult.error);
    this.loading.set(false);
  }

  toggleSummary(): void {
    this.showSummary.update((v) => !v);
  }

  telHref(phone: string): string {
    return buildTelHref(phone);
  }

  mapsUrl(order: Order): string {
    return buildMapsUrl(order);
  }

  onDraftStatus(orderId: number, status: OrderStatus): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: { ...current[orderId], status },
    }));
  }

  onDraftPayment(orderId: number, payment: PaymentMethod | null): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: { ...current[orderId], payment_method: payment },
    }));
  }

  onDraftAmount(orderId: number, amount: string): void {
    this.drafts.update((current) => ({
      ...current,
      [orderId]: { ...current[orderId], collected_amount: amount },
    }));
  }

  async saveOrder(order: Order): Promise<void> {
    const draft = this.drafts()[order.id];
    if (!draft) {
      return;
    }

    this.savingId.set(order.id);
    this.errorMessage.set(null);

    const { data, error } = await this.courierService.updateAssignedOrder(order.id, draft);
    this.savingId.set(null);

    if (error || !data) {
      this.errorMessage.set(error ?? 'შენახვა ვერ მოხერხდა');
      return;
    }

    this.orders.update((list) => list.map((item) => (item.id === order.id ? data : item)));
    this.drafts.update((current) => ({
      ...current,
      [order.id]: {
        status: data.status,
        payment_method: data.payment_method,
        collected_amount: formatGel(data.collected_amount),
      },
    }));

    const summaryResult = await this.courierService.getTodayDeliveredSummary();
    if (!summaryResult.error) {
      this.summary.set(summaryResult.data);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
