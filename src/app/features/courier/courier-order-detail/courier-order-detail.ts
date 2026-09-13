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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Order, PaymentMethod } from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
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
  selector: 'app-courier-order-detail',
  imports: [DatePipe, RouterLink],
  templateUrl: './courier-order-detail.html',
  styleUrl: './courier-order-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierOrderDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly courierService = inject(CourierService);
  private readonly realtime = inject(CourierRealtimeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly order = signal<Order | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly paymentMethod = signal<PaymentMethod | null>(null);
  readonly confirmingCancel = signal(false);

  readonly statusClass = orderStatusClass;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly statusLabel = courierStatusLabel;
  readonly paymentLabel = paymentMethodLabel;

  private orderId: number | null = null;

  constructor() {
    this.realtime.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.refreshFromRealtime();
    });
  }

  isActiveStatus(status: Order['status']): boolean {
    return this.courierService.isActiveStatus(status);
  }

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id)) {
      this.errorMessage.set('არასწორი შეკვეთა');
      this.loading.set(false);
      return;
    }

    this.orderId = id;
    await this.loadOrder(id, true);
  }

  private async refreshFromRealtime(): Promise<void> {
    if (this.saving() || this.orderId === null) {
      return;
    }
    await this.loadOrder(this.orderId, false);
  }

  private async loadOrder(id: number, showLoading: boolean): Promise<void> {
    if (showLoading) {
      this.loading.set(true);
    }

    const { data, error } = await this.courierService.getOrderById(id);
    if (error || !data) {
      this.order.set(null);
      this.errorMessage.set(error ?? 'შეკვეთა ვერ მოიძებნა');
      this.loading.set(false);
      return;
    }

    this.order.set(data);
    this.paymentMethod.set(data.payment_method);
    this.loading.set(false);
  }

  telHref(phone: string): string {
    return buildTelHref(phone);
  }

  mapsUrl(order: Order): string {
    return buildMapsUrl(order);
  }

  selectPayment(payment: PaymentMethod): void {
    this.paymentMethod.set(payment);
    this.errorMessage.set(null);
  }

  async markDelivered(): Promise<void> {
    const current = this.order();
    if (!current) return;

    const payment = this.paymentMethod();
    if (!payment) {
      this.errorMessage.set('აირჩიეთ გადახდის მეთოდი — ქეში ან ბარათი.');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.confirmingCancel.set(false);

    try {
      const { data, error } = await this.courierService.completeOrder(
        current.id,
        payment,
        current.assigned_courier_id,
      );

      if (error || !data) {
        console.error('CourierOrderDetail.markDelivered failed:', error);
        this.errorMessage.set(error ?? 'ჩაბარება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.order.set({ ...current, ...data });
      this.successMessage.set('შეკვეთა ჩაბარდა');
      await this.router.navigateByUrl('/courier/history');
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`ჩაბარება ვერ მოხერხდა: ${message}`);
    } finally {
      this.saving.set(false);
    }
  }

  requestCancel(): void {
    this.confirmingCancel.set(true);
  }

  dismissCancel(): void {
    this.confirmingCancel.set(false);
  }

  async confirmCancel(): Promise<void> {
    const current = this.order();
    if (!current) return;

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.cancelOrder(
        current.id,
        current.assigned_courier_id,
      );

      if (error || !data) {
        console.error('CourierOrderDetail.confirmCancel failed:', error);
        this.errorMessage.set(error ?? 'გაუქმება ვერ მოხერხდა');
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.order.set({ ...current, ...data });
      this.successMessage.set('შეკვეთა გაუქმდა');
      await this.router.navigateByUrl('/courier/history');
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`გაუქმება ვერ მოხერხდა: ${message}`);
    } finally {
      this.saving.set(false);
    }
  }
}
