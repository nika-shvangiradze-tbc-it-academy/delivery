import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import i18next from 'i18next';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Order, PaymentMethod } from '../../../core/models/order.model';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
import {
  buildTelHref,
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  orderStatusClass,
  paymentMethodLabel,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-order-detail',
  imports: [DatePipe, RouterLink, TranslatePipe],
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
  readonly cancelReasonDraft = signal('');
  readonly cancelReasonError = signal<string | null>(null);

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

  canMarkPickedUp(status: Order['status']): boolean {
    return status === 'office' || status === 'pending';
  }

  async ngOnInit(): Promise<void> {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id)) {
      this.errorMessage.set(i18next.t('courier.invalidOrder'));
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
      this.errorMessage.set(error ?? i18next.t('courier.orderNotFound'));
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

  selectPayment(payment: PaymentMethod): void {
    this.paymentMethod.set(payment);
    this.errorMessage.set(null);
  }

  async markPickedUp(): Promise<void> {
    const current = this.order();
    if (!current || current.status !== 'pending') return;

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.confirmingCancel.set(false);

    try {
      const { data, error } = await this.courierService.changeOrderStatus(
        current.id,
        'picked_up',
        null,
        current.assigned_courier_id,
      );

      if (error || !data) {
        this.errorMessage.set(error ?? i18next.t('courier.pickupFailed'));
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.order.set({ ...current, ...data });
      this.successMessage.set(i18next.t('courier.orderPickedUp'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.pickupFailedWithReason', { message }));
    } finally {
      this.saving.set(false);
    }
  }

  async markDelivered(): Promise<void> {
    const current = this.order();
    if (!current) return;

    const payment = this.paymentMethod();
    if (!payment) {
      this.errorMessage.set(i18next.t('courier.paymentRequired'));
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
        this.errorMessage.set(error ?? i18next.t('courier.deliverFailed'));
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.order.set({ ...current, ...data });
      this.successMessage.set(i18next.t('courier.orderDelivered'));
      await this.router.navigateByUrl('/courier/history');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.deliverFailedWithReason', { message }));
    } finally {
      this.saving.set(false);
    }
  }

  requestCancel(): void {
    this.confirmingCancel.set(true);
    this.cancelReasonDraft.set('');
    this.cancelReasonError.set(null);
  }

  dismissCancel(): void {
    this.confirmingCancel.set(false);
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

  async confirmCancel(reasonFromInput?: string): Promise<void> {
    const current = this.order();
    if (!current) return;

    const reason = [reasonFromInput, this.cancelReasonDraft()]
      .map((value) => String(value ?? '').trim())
      .find((value) => value.length > 0) ?? '';
    if (!reason) {
      this.cancelReasonError.set(i18next.t('courier.pickupCancelReasonRequired'));
      this.errorMessage.set(null);
      return;
    }

    if (this.saving()) {
      return;
    }

    this.cancelReasonDraft.set(reason);
    this.saving.set(true);
    this.cancelReasonError.set(null);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const { data, error } = await this.courierService.cancelOrder(
        current.id,
        reason,
        current.assigned_courier_id,
      );

      if (error || !data) {
        this.errorMessage.set(error ?? i18next.t('courier.cancelFailed'));
        if (error?.includes('სესია არ არის აქტიური')) {
          await this.router.navigateByUrl('/login');
        }
        return;
      }

      this.confirmingCancel.set(false);
      this.cancelReasonDraft.set('');
      this.order.set({ ...current, ...data });
      this.successMessage.set(i18next.t('courier.orderCancelled'));
      await this.router.navigateByUrl('/courier/history');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.errorMessage.set(i18next.t('courier.cancelFailedWithReason', { message }));
    } finally {
      this.saving.set(false);
    }
  }
}
