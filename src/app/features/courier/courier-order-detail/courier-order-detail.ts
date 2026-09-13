import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  COURIER_ALLOWED_STATUSES,
  Order,
  OrderStatus,
  PaymentMethod,
} from '../../../core/models/order.model';
import { CourierService } from '../../../core/services/courier.service';
import {
  buildMapsUrl,
  buildTelHref,
  formatGel,
  orderStatusClass,
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

  readonly status = signal<OrderStatus>('accepted');
  readonly paymentMethod = signal<PaymentMethod | null>(null);
  readonly amount = signal('0.00');

  readonly allowedStatuses = COURIER_ALLOWED_STATUSES;
  readonly statusClass = orderStatusClass;

  readonly statusLabel = (value: OrderStatus): string => {
    const map: Record<string, string> = {
      accepted: 'მინიჭებული',
      picked_up: 'აღებული',
      in_transit: 'გზაში',
      delivered: 'მიწოდებული',
      pending: 'მოლოდინში',
      cancelled: 'გაუქმებული',
    };
    return map[value] ?? value;
  };

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
    this.status.set(data.status === 'pending' ? 'accepted' : data.status);
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

  async save(): Promise<void> {
    const current = this.order();
    if (!current) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    const { data, error } = await this.courierService.updateAssignedOrder(current.id, {
      status: this.status(),
      payment_method: this.paymentMethod(),
      collected_amount: this.amount(),
    });

    this.saving.set(false);

    if (error || !data) {
      this.errorMessage.set(error ?? 'შენახვა ვერ მოხერხდა');
      return;
    }

    this.order.set(data);
    this.status.set(data.status);
    this.paymentMethod.set(data.payment_method);
    this.amount.set(formatGel(data.collected_amount));
  }

  async back(): Promise<void> {
    await this.router.navigateByUrl('/courier/orders');
  }
}
