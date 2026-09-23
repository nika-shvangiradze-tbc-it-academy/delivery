import i18next from 'i18next';
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
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  AdminPickupTaskCounts,
  AdminPickupTaskStatusFilter,
  PickupTask,
} from '../../../core/models/order.model';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import {
  formatTbilisiDateTime,
  formatTbilisiDotDateTime,
} from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';
import { TranslatePipe } from '../../../core/pipes/t.pipe';

const EMPTY_COUNTS: AdminPickupTaskCounts = {
  assigned: 0,
  picked_up: 0,
  cancelled: 0,
};

@Component({
  selector: 'app-admin-pickup-tasks',
  imports: [DeliveryHeader, TranslatePipe],
  templateUrl: './pickup-tasks.html',
  styleUrl: './pickup-tasks.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPickupTasks implements OnInit, OnDestroy {
  private readonly adminService = inject(AdminService);
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  readonly tasks = signal<PickupTask[]>([]);
  readonly counts = signal<AdminPickupTaskCounts>(EMPTY_COUNTS);
  readonly statusFilter = signal<AdminPickupTaskStatusFilter>('all');
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly formatAuditTime = formatTbilisiDateTime;
  readonly formatCancelTime = formatTbilisiDotDateTime;

  private pickupChannel: RealtimeChannel | null = null;
  private loadGeneration = 0;

  ngOnInit(): void {
    void this.loadTasks();
    void this.subscribePickupRealtime();
  }

  ngOnDestroy(): void {
    this.teardownPickupChannel();
  }

  setStatusFilter(filter: AdminPickupTaskStatusFilter): void {
    if (this.statusFilter() === filter) return;
    this.statusFilter.set(filter);
    void this.loadTasks();
  }

  async loadTasks(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.errorMessage.set(null);

    const { data, error } = await this.adminService.getPickupTasks(this.statusFilter());
    if (generation !== this.loadGeneration) {
      return;
    }

    this.loading.set(false);
    if (error) {
      this.errorMessage.set(error);
      this.tasks.set([]);
      return;
    }

    this.tasks.set(data.tasks);
    this.counts.set(data.counts);
  }

  taskAddress(task: PickupTask): string {
    const loc = task.locations[0];
    if (loc) {
      return (
        [loc.city, loc.district, loc.address]
          .map((p) => (p ?? '').trim())
          .filter(Boolean)
          .join(', ') || '—'
      );
    }
    return (
      [task.pickup_city, task.pickup_district, task.pickup_address]
        .map((p) => (p ?? '').trim())
        .filter(Boolean)
        .join(', ') || '—'
    );
  }

  statusLabel(status: PickupTask['status']): string {
    switch (status) {
      case 'picked_up':
        return i18next.t('ui.pickedUp');
      case 'cancelled':
        return i18next.t('ui.cancelled');
      default:
        return i18next.t('adminUi.current');
    }
  }

  private async subscribePickupRealtime(): Promise<void> {
    this.teardownPickupChannel();
    await this.auth.whenReady();

    this.pickupChannel = this.supabase.client
      .channel('admin-pickup-tasks')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pickup_tasks' },
        () => {
          this.zone.run(() => {
            void this.loadTasks();
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pickup_tasks' },
        () => {
          this.zone.run(() => {
            void this.loadTasks();
          });
        },
      )
      .subscribe();
  }

  private teardownPickupChannel(): void {
    if (this.pickupChannel) {
      void this.supabase.client.removeChannel(this.pickupChannel);
      this.pickupChannel = null;
    }
  }
}
