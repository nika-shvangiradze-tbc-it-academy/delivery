import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  COURIER_CORRECTION_STATUSES,
  CourierStatus,
  Order,
  PaymentMethod,
} from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
import {
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  historyCompletedAt,
  orderStatusClass,
  paymentMethodLabel,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-history',
  imports: [DatePipe],
  templateUrl: './courier-history.html',
  styleUrl: './courier-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierHistory implements OnInit {
  private readonly courierService = inject(CourierService);
  private readonly realtime = inject(CourierRealtimeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly draftStatus = signal<CourierStatus>('accepted');
  readonly draftPayment = signal<PaymentMethod | null>(null);

  readonly correctionStatuses = COURIER_CORRECTION_STATUSES;
  readonly statusClass = orderStatusClass;
  readonly statusLabel = courierStatusLabel;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly paymentLabel = paymentMethodLabel;
  readonly completedAt = historyCompletedAt;

  constructor() {
    this.realtime.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.refreshFromRealtime();
    });
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    await this.fetchHistory();
    this.loading.set(false);
  }

  /** Soft refresh from Realtime — no full-page loading flash. */
  private async refreshFromRealtime(): Promise<void> {
    if (this.savingId() !== null) {
      return;
    }
    await this.fetchHistory();
  }

  private async fetchHistory(): Promise<void> {
    const { data, error } = await this.courierService.getMyHistoryOrders();
    this.orders.set(data);

    const editing = this.editingId();
    if (editing !== null && !data.some((o) => o.id === editing)) {
      this.editingId.set(null);
      this.draftPayment.set(null);
    }

    if (error) {
      this.errorMessage.set(error);
    }
  }

  openCorrection(order: Order): void {
    this.editingId.set(order.id);
    this.draftStatus.set(
      (COURIER_CORRECTION_STATUSES as string[]).includes(order.status)
        ? (order.status as CourierStatus)
        : 'accepted',
    );
    this.draftPayment.set(order.payment_method);
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  closeCorrection(): void {
    this.editingId.set(null);
    this.draftPayment.set(null);
  }

  selectDraftStatus(status: CourierStatus): void {
    this.draftStatus.set(status);
    if (status !== 'delivered') {
      this.draftPayment.set(null);
    }
  }

  selectDraftPayment(payment: PaymentMethod): void {
    this.draftPayment.set(payment);
  }

  needsPayment(): boolean {
    return this.draftStatus() === 'delivered';
  }

  async saveCorrection(order: Order): Promise<void> {
    const newStatus = this.draftStatus();
    const payment = this.draftPayment();

    if (newStatus === 'delivered' && !payment) {
      this.errorMessage.set('აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.');
      return;
    }

    this.savingId.set(order.id);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.changeOrderStatus(
        order.id,
        newStatus,
        payment,
        order.assigned_courier_id,
      );

      if (error || !data) {
        console.error('CourierHistory.saveCorrection failed:', error);
        this.errorMessage.set(error ?? 'სტატუსის შეცვლა ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.editingId.set(null);

      if (this.courierService.isHistoryStatus(data.status)) {
        this.orders.update((list) =>
          list.map((item) => (item.id === order.id ? { ...item, ...data } : item)),
        );
        this.successMessage.set('სტატუსი განახლდა');
      } else {
        this.orders.update((list) => list.filter((item) => item.id !== order.id));
        this.successMessage.set('შეკვეთა დაბრუნდა აქტიურებში');
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`სტატუსის შეცვლა ვერ მოხერხდა: ${message}`);
    } finally {
      this.savingId.set(null);
    }
  }
}
