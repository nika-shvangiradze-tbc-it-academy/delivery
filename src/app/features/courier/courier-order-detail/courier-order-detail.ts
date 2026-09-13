import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  COURIER_ALLOWED_STATUSES,
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
  selector: 'app-courier-order-detail',
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './courier-order-detail.html',
  styleUrl: './courier-order-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierOrderDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly courierService = inject(CourierService);
  private readonly router = inject(Router);

  readonly order = signal<Order | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly status = signal<CourierStatus>('accepted');
  readonly paymentMethod = signal<PaymentMethod | null>(null);
  readonly amount = signal('0.00');

  readonly allowedStatuses = COURIER_ALLOWED_STATUSES;
  readonly statusClass = orderStatusClass;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly statusLabel = courierStatusLabel;
  readonly paymentLabel = paymentMethodLabel;

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

    const { data, error } = await this.courierService.getOrderById(id);
    if (error || !data) {
      this.errorMessage.set(error ?? 'შეკვეთა ვერ მოიძებნა');
      this.loading.set(false);
      return;
    }

    this.order.set(data);
    this.status.set(
      data.status === 'pending' || !(COURIER_ALLOWED_STATUSES as string[]).includes(data.status)
        ? 'accepted'
        : (data.status as CourierStatus),
    );
    this.paymentMethod.set(data.payment_method);
    this.amount.set(formatGel(data.collected_amount));
    this.loading.set(false);
  }

  telHref(phone: string): string {
    return buildTelHref(phone);
  }

  mapsUrl(order: Order): string {
    return buildMapsUrl(order);
  }

  onPaymentChange(value: PaymentMethod | null): void {
    this.paymentMethod.set(value);
  }

  async save(): Promise<void> {
    const current = this.order();
    if (!current) return;

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.updateAssignedOrder(
        current.id,
        {
          status: this.status(),
          payment_method: this.paymentMethod(),
          collected_amount: this.amount(),
        },
        current.assigned_courier_id,
      );

      if (error || !data) {
        console.error('CourierOrderDetail.save failed:', error);
        this.errorMessage.set(`შენახვა ვერ მოხერხდა: ${error ?? 'Unknown error'}`);
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.order.set({
        ...current,
        ...data,
        status: data.status,
        payment_method: data.payment_method,
        collected_amount: data.collected_amount,
      });
      this.status.set(
        (COURIER_ALLOWED_STATUSES as string[]).includes(data.status)
          ? (data.status as CourierStatus)
          : this.status(),
      );
      this.paymentMethod.set(data.payment_method);
      this.amount.set(formatGel(data.collected_amount));
      this.errorMessage.set(null);
      this.successMessage.set('შეინახა');

      if (!this.courierService.isActiveStatus(data.status)) {
        await this.router.navigateByUrl('/courier/history');
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(`შენახვა ვერ მოხერხდა: ${message}`);
    } finally {
      this.saving.set(false);
    }
  }
}
