import { Injectable, inject } from '@angular/core';
import {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';

type OrderRealtimeRow = {
  id?: number;
  assigned_courier_id?: string | null;
  status?: string | null;
};

/**
 * One Realtime channel per logged-in courier session.
 * Listens to orders + courier_order_events, then asks pages to refetch.
 */
@Injectable({
  providedIn: 'root',
})
export class CourierRealtimeService {
  private readonly supabase = inject(SupabaseService);

  private channel: RealtimeChannel | null = null;
  private activeCourierId: string | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  private readonly changesSubject = new Subject<void>();

  /** Debounced signal that courier order lists / summary should reload. */
  readonly changes$ = this.changesSubject.asObservable();

  /** Channel name for the current courier, or null when disconnected. */
  get channelName(): string | null {
    return this.activeCourierId ? `courier-orders:${this.activeCourierId}` : null;
  }

  connect(courierId: string): void {
    if (!courierId) {
      this.disconnect();
      return;
    }

    if (this.activeCourierId === courierId && this.channel) {
      return;
    }

    this.disconnect();
    this.activeCourierId = courierId;
    this.subscribe(courierId);
  }

  disconnect(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }

    if (this.channel) {
      void this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }

    this.activeCourierId = null;
  }

  private subscribe(courierId: string): void {
    const channelName = `courier-orders:${courierId}`;

    const channel = this.supabase.client
      .channel(channelName)
      // Filtered orders feed: assign-to-me + status/payment updates while assigned.
      // Reassignment-away is covered by courier_order_events (RLS-safe).
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `assigned_courier_id=eq.${courierId}`,
        },
        (payload: RealtimePostgresChangesPayload<OrderRealtimeRow>) => {
          this.onOrdersChange(courierId, payload);
        },
      )
      // Assignment pings (including unassign / reassignment away).
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'courier_order_events',
          filter: `courier_id=eq.${courierId}`,
        },
        (payload) => {
          this.log('relevant order event', {
            source: 'courier_order_events',
            event: payload.eventType,
            row: payload.new,
          });
          this.scheduleRefresh();
        },
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          this.log('subscribed', { channel: channelName });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[CourierRealtime] channel error', { status, err, channel: channelName });
        }
      });

    this.channel = channel;
  }

  private onOrdersChange(
    courierId: string,
    payload: RealtimePostgresChangesPayload<OrderRealtimeRow>,
  ): void {
    const next = (payload.new ?? {}) as OrderRealtimeRow;
    const prev = (payload.old ?? {}) as OrderRealtimeRow;

    const involved =
      next.assigned_courier_id === courierId || prev.assigned_courier_id === courierId;

    if (!involved) {
      return;
    }

    this.log('relevant order event', {
      source: 'orders',
      event: payload.eventType,
      orderId: next.id ?? prev.id ?? null,
      oldCourier: prev.assigned_courier_id ?? null,
      newCourier: next.assigned_courier_id ?? null,
      status: next.status ?? prev.status ?? null,
    });

    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.log('refreshing active orders');
      this.changesSubject.next();
    }, 200);
  }

  private log(message: string, data?: unknown): void {
    if (environment.production) {
      return;
    }
    if (data !== undefined) {
      console.info(`[CourierRealtime] ${message}`, data);
    } else {
      console.info(`[CourierRealtime] ${message}`);
    }
  }
}
