import { Injectable, inject } from '@angular/core';
import { OrderRealtimeService } from './order-realtime.service';

/**
 * Thin courier-facing facade over {@link OrderRealtimeService}.
 * Prefer OrderRealtimeService for new call sites; this keeps existing courier pages stable.
 */
@Injectable({
  providedIn: 'root',
})
export class CourierRealtimeService {
  private readonly ordersRealtime = inject(OrderRealtimeService);

  /** Debounced signal that courier order lists / summary should reload. */
  readonly changes$ = this.ordersRealtime.courierChanges$;

  /** Immediate hard refresh (logo click) — bypasses realtime debounce. */
  readonly manualRefresh$ = this.ordersRealtime.courierManualRefresh$;

  /** Channel name for the current courier, or null when disconnected. */
  get channelName(): string | null {
    return this.ordersRealtime.currentRole === 'courier'
      ? this.ordersRealtime.channelName
      : null;
  }

  /**
   * Idempotent — OrderRealtimeService also auto-connects from auth.
   * Safe to call from courier shell.
   */
  connect(courierId: string): void {
    if (!courierId) {
      return;
    }
    this.ordersRealtime.connect('courier', courierId);
  }

  /**
   * Only tears down when the active session channel is the courier channel.
   * Auth logout / role change is handled by OrderRealtimeService.
   */
  disconnect(): void {
    if (this.ordersRealtime.currentRole === 'courier') {
      this.ordersRealtime.disconnect();
    }
  }

  requestRefresh(): void {
    this.ordersRealtime.requestCourierRefresh();
  }

  requestManualRefresh(): void {
    this.ordersRealtime.requestCourierManualRefresh();
  }
}
