import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  COURIER_CORRECTION_STATUSES,
  CourierPickupHistoryFilter,
  CourierStatus,
  Order,
  PaymentMethod,
  PickupTask,
  PickupTaskLocation,
} from '../../../core/models/order.model';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { CourierService } from '../../../core/services/courier.service';
import {
  courierStatusLabel,
  formatGel,
  formatPhoneDisplay,
  formatTbilisiDateTime,
  formatTbilisiDotDateTime,
  historyCompletedAt,
  orderStatusClass,
  paymentMethodLabel,
} from '../../../core/utils/order-status.util';

export type HistoryFilter = 'all' | 'delivered' | 'cancelled';
export type HistorySection = 'delivery' | 'pickup';

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

  readonly historySection = signal<HistorySection>('delivery');

  readonly orders = signal<Order[]>([]);
  readonly pickupTasks = signal<PickupTask[]>([]);
  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly draftStatus = signal<CourierStatus>('picked_up');
  readonly draftPayment = signal<PaymentMethod | null>(null);
  readonly historyFilter = signal<HistoryFilter>('all');
  readonly pickupHistoryFilter = signal<CourierPickupHistoryFilter>('all');

  readonly filterOptions: ReadonlyArray<{ id: HistoryFilter; label: string }> = [
    { id: 'all', label: 'ყველა' },
    { id: 'delivered', label: 'ჩაბარებული' },
    { id: 'cancelled', label: 'გაუქმებული' },
  ];

  readonly pickupFilterOptions: ReadonlyArray<{
    id: CourierPickupHistoryFilter;
    label: string;
  }> = [
    { id: 'all', label: 'ყველა' },
    { id: 'picked_up', label: 'აღებული' },
    { id: 'cancelled', label: 'გაუქმებული' },
  ];

  readonly filteredOrders = computed(() => {
    const filter = this.historyFilter();
    const list = this.orders();
    if (filter === 'all') {
      return list;
    }
    return list.filter((order) => order.status === filter);
  });

  readonly filteredPickupTasks = computed(() => {
    const filter = this.pickupHistoryFilter();
    const list = this.pickupTasks();
    if (filter === 'all') {
      return list;
    }
    return list.filter((task) => task.status === filter);
  });

  readonly correctionStatuses = COURIER_CORRECTION_STATUSES;
  readonly statusClass = orderStatusClass;
  readonly statusLabel = courierStatusLabel;
  readonly formatGel = formatGel;
  readonly formatPhone = formatPhoneDisplay;
  readonly paymentLabel = paymentMethodLabel;
  readonly completedAt = historyCompletedAt;
  readonly formatPickupTime = formatTbilisiDateTime;
  readonly formatCancelTime = formatTbilisiDotDateTime;

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

  setHistorySection(section: HistorySection): void {
    if (this.historySection() === section) return;
    this.historySection.set(section);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.closeCorrection();
  }

  setHistoryFilter(filter: HistoryFilter): void {
    this.historyFilter.set(filter);
  }

  setPickupHistoryFilter(filter: CourierPickupHistoryFilter): void {
    this.pickupHistoryFilter.set(filter);
  }

  emptyStateText(): string {
    switch (this.historyFilter()) {
      case 'delivered':
        return 'ჩაბარებული შეკვეთები არ არის.';
      case 'cancelled':
        return 'გაუქმებული შეკვეთები არ არის.';
      default:
        return 'ისტორია ცარიელია.';
    }
  }

  pickupEmptyStateText(): string {
    switch (this.pickupHistoryFilter()) {
      case 'picked_up':
        return 'აღებული დავალებები არ არის.';
      case 'cancelled':
        return 'გაუქმებული აღების დავალებები არ არის.';
      default:
        return 'აღების ისტორია ცარიელია.';
    }
  }

  pickupAddress(task: PickupTask): string {
    const loc = task.locations[0];
    if (loc) {
      return this.locationLabel(loc);
    }
    return (
      [task.pickup_city, task.pickup_district, task.pickup_address]
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(', ') || '—'
    );
  }

  locationLabel(loc: PickupTaskLocation): string {
    return (
      [loc.city, loc.district, loc.address]
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(', ') || '—'
    );
  }

  pickupStatusLabel(status: PickupTask['status']): string {
    return status === 'cancelled' ? 'გაუქმებული' : 'აღებული';
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);
    await this.fetchAllHistory();
    this.loading.set(false);
  }

  /** Soft refresh from Realtime — no full-page loading flash. */
  private async refreshFromRealtime(): Promise<void> {
    if (this.savingId() !== null) {
      return;
    }
    await this.fetchAllHistory();
  }

  private async fetchAllHistory(): Promise<void> {
    const [ordersResult, pickupResult] = await Promise.all([
      this.courierService.getMyHistoryOrders(),
      this.courierService.getMyPickupHistory('all'),
    ]);

    this.orders.set(ordersResult.data);
    this.pickupTasks.set(pickupResult.data);

    const editing = this.editingId();
    if (editing !== null && !ordersResult.data.some((o) => o.id === editing)) {
      this.editingId.set(null);
      this.draftPayment.set(null);
    }

    if (ordersResult.error || pickupResult.error) {
      this.errorMessage.set(ordersResult.error ?? pickupResult.error);
    }
  }

  openCorrection(order: Order): void {
    this.editingId.set(order.id);
    this.draftStatus.set(
      (COURIER_CORRECTION_STATUSES as string[]).includes(order.status)
        ? (order.status as CourierStatus)
        : 'picked_up',
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

    const { data, error } = await this.courierService.changeOrderStatus(
      order.id,
      newStatus,
      newStatus === 'delivered' ? payment : null,
    );

    this.savingId.set(null);

    if (error || !data) {
      if (error === 'Not authenticated') {
        await this.router.navigateByUrl('/login');
        return;
      }
      this.errorMessage.set(error ?? 'სტატუსის შეცვლა ვერ მოხერხდა');
      return;
    }

    this.orders.update((list) => list.map((item) => (item.id === data.id ? data : item)));
    this.editingId.set(null);
    this.draftPayment.set(null);
    this.successMessage.set('სტატუსი განახლდა');
  }
}
