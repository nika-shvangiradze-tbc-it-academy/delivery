import { Injectable, NgZone, effect, inject } from '@angular/core';
import {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

/** Role that owns the single active Realtime channel for this session. */
export type OrderRealtimeRole = 'admin' | 'courier' | 'user';

/** Subset of order columns used for Realtime payload inspection. */
export type OrderRealtimeRow = {
  id?: number;
  user_id?: string | null;
  assigned_courier_id?: string | null;
  status?: string | null;
  is_fragile?: boolean | null;
  amount_to_collect?: number | string | null;
  payment_method?: string | null;
  delivery_date?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export type OrderRealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface OrderRealtimeChange {
  eventType: OrderRealtimeEventType;
  orderId: number | null;
  oldRow: OrderRealtimeRow | null;
  newRow: OrderRealtimeRow | null;
  source: 'orders' | 'courier_order_events';
}

/**
 * Centralized Supabase Realtime for `orders` (and courier ping table).
 *
 * One logical channel per authenticated session/role — no per-component channels.
 * Auth-driven connect/disconnect; role change / logout tears down cleanly.
 */
@Injectable({
  providedIn: 'root',
})
export class OrderRealtimeService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private channel: RealtimeChannel | null = null;
  private activeRole: OrderRealtimeRole | null = null;
  private activeUserId: string | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  private connectGeneration = 0;

  private readonly adminChangesSubject = new Subject<OrderRealtimeChange>();
  private readonly userChangesSubject = new Subject<OrderRealtimeChange>();
  private readonly courierChangesSubject = new Subject<void>();
  private readonly courierManualRefreshSubject = new Subject<void>();

  /** Debounced admin order events (INSERT/UPDATE/DELETE). */
  readonly adminChanges$ = this.adminChangesSubject.asObservable();

  /** Debounced user (owner) order events. */
  readonly userChanges$ = this.userChangesSubject.asObservable();

  /** Debounced courier soft-refresh signal (lists / summary / detail). */
  readonly courierChanges$ = this.courierChangesSubject.asObservable();

  /** Immediate hard refresh (courier logo click). */
  readonly courierManualRefresh$ = this.courierManualRefreshSubject.asObservable();

  get channelName(): string | null {
    if (!this.activeRole || !this.activeUserId) {
      return null;
    }
    return this.buildChannelName(this.activeRole, this.activeUserId);
  }

  get currentRole(): OrderRealtimeRole | null {
    return this.activeRole;
  }

  constructor() {
    // Eager session binding — single subscription for the logged-in role.
    effect(() => {
      const ready = this.auth.isReady();
      const profile = this.auth.profile();
      const userId = this.auth.user()?.id ?? null;

      if (!ready) {
        return;
      }

      if (!profile || !userId) {
        this.disconnect();
        return;
      }

      if (profile.role === 'admin') {
        this.connect('admin', userId);
      } else if (profile.role === 'courier') {
        this.connect('courier', userId);
      } else {
        this.connect('user', userId);
      }
    });
  }

  /**
   * Explicit connect (idempotent). Prefer auth-driven lifecycle; safe for shells.
   */
  connect(role: OrderRealtimeRole, userId: string): void {
    if (!role || !userId) {
      this.disconnect();
      return;
    }

    if (this.activeRole === role && this.activeUserId === userId && this.channel) {
      return;
    }

    this.disconnect();
    this.activeRole = role;
    this.activeUserId = userId;
    void this.subscribe(role, userId);
  }

  disconnect(): void {
    this.connectGeneration += 1;

    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }

    if (this.reconnectHandle !== null) {
      clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }

    if (this.channel) {
      void this.supabase.client.removeChannel(this.channel);
      this.channel = null;
    }

    this.activeRole = null;
    this.activeUserId = null;
  }

  /** Soft refresh for courier pages (realtime path). */
  requestCourierRefresh(): void {
    if (this.activeRole === 'courier') {
      this.scheduleRoleEmit('courier');
    }
  }

  /** Hard refresh for courier logo click — immediate, no debounce. */
  requestCourierManualRefresh(): void {
    this.log('courier manual refresh requested');
    this.zone.run(() => {
      this.courierManualRefreshSubject.next();
    });
  }

  private buildChannelName(role: OrderRealtimeRole, userId: string): string {
    switch (role) {
      case 'admin':
        return `admin-orders:${userId}`;
      case 'courier':
        return `courier-orders:${userId}`;
      case 'user':
        return `user-orders:${userId}`;
    }
  }

  private async subscribe(role: OrderRealtimeRole, userId: string): Promise<void> {
    const generation = this.connectGeneration;
    const channelName = this.buildChannelName(role, userId);

    const {
      data: { session },
    } = await this.supabase.client.auth.getSession();

    if (generation !== this.connectGeneration || this.activeUserId !== userId) {
      return;
    }

    if (session?.access_token) {
      await this.supabase.client.realtime.setAuth(session.access_token);
    }

    if (generation !== this.connectGeneration || this.activeUserId !== userId) {
      return;
    }

    let channel = this.supabase.client.channel(channelName);

    if (role === 'admin') {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload: RealtimePostgresChangesPayload<OrderRealtimeRow>) => {
          this.onOrdersPayload('admin', userId, payload);
        },
      );
    } else if (role === 'user') {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresChangesPayload<OrderRealtimeRow>) => {
          this.onOrdersPayload('user', userId, payload);
        },
      );
    } else {
      // Courier: assigned rows + ping table for unassign / reassignment-away under RLS.
      channel = channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'orders',
            filter: `assigned_courier_id=eq.${userId}`,
          },
          (payload: RealtimePostgresChangesPayload<OrderRealtimeRow>) => {
            this.onCourierOrdersChange(userId, payload);
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'courier_order_events',
            filter: `courier_id=eq.${userId}`,
          },
          (payload) => {
            const row = (payload.new ?? {}) as { order_id?: number; event_type?: string };
            this.log('relevant order event', {
              source: 'courier_order_events',
              event: payload.eventType,
              row,
            });
            this.queueChange({
              eventType: 'UPDATE',
              orderId: row.order_id ?? null,
              oldRow: null,
              newRow: null,
              source: 'courier_order_events',
            });
          },
        );
    }

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        this.log('SUBSCRIBED', { channel: channelName, role });
      } else if (status === 'CLOSED') {
        this.log('CLOSED', { channel: channelName, role });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[OrderRealtime] channel error', {
          status,
          err,
          channel: channelName,
          role,
        });
        this.scheduleReconnect(role, userId, generation);
      }
    });

    if (generation !== this.connectGeneration || this.activeUserId !== userId) {
      void this.supabase.client.removeChannel(channel);
      return;
    }

    this.channel = channel;
  }

  private scheduleReconnect(
    role: OrderRealtimeRole,
    userId: string,
    generation: number,
  ): void {
    if (generation !== this.connectGeneration) {
      return;
    }
    if (this.reconnectHandle !== null) {
      return;
    }

    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = null;
      if (generation !== this.connectGeneration) {
        return;
      }
      if (this.activeRole !== role || this.activeUserId !== userId) {
        return;
      }
      this.log('reconnecting channel', { role, userId });
      if (this.channel) {
        void this.supabase.client.removeChannel(this.channel);
        this.channel = null;
      }
      void this.subscribe(role, userId);
    }, 1500);
  }

  private onOrdersPayload(
    role: 'admin' | 'user',
    userId: string,
    payload: RealtimePostgresChangesPayload<OrderRealtimeRow>,
  ): void {
    const next = (payload.new ?? null) as OrderRealtimeRow | null;
    const prev = (payload.old ?? null) as OrderRealtimeRow | null;

    if (role === 'user') {
      const ownerId = next?.user_id ?? prev?.user_id ?? null;
      // Filter is already `user_id=eq.me`; this is a belt-and-suspenders guard.
      if (ownerId && ownerId !== userId) {
        return;
      }
    }

    const eventType = this.mapEventType(payload.eventType);
    if (!eventType) {
      return;
    }

    const orderId = next?.id ?? prev?.id ?? null;
    this.log('relevant order event', {
      source: 'orders',
      role,
      event: eventType,
      orderId,
      status: next?.status ?? prev?.status ?? null,
      isFragile: next?.is_fragile ?? prev?.is_fragile ?? null,
      oldCourier: prev?.assigned_courier_id ?? null,
      newCourier: next?.assigned_courier_id ?? null,
    });

    this.queueChange({
      eventType,
      orderId: orderId != null ? Number(orderId) : null,
      oldRow: prev,
      newRow: next,
      source: 'orders',
    });
  }

  /**
   * Courier orders filter is `assigned_courier_id=eq.me`, so unassign may not
   * arrive here (RLS + filter). Still inspect old/new when both are present;
   * `courier_order_events` covers reassignment-away.
   */
  private onCourierOrdersChange(
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

    const eventType = this.mapEventType(payload.eventType) ?? 'UPDATE';

    this.log('relevant order event', {
      source: 'orders',
      role: 'courier',
      event: eventType,
      orderId: next.id ?? prev.id ?? null,
      oldCourier: prev.assigned_courier_id ?? null,
      newCourier: next.assigned_courier_id ?? null,
      status: next.status ?? prev.status ?? null,
      isFragile: next.is_fragile ?? prev.is_fragile ?? null,
    });

    this.queueChange({
      eventType,
      orderId: next.id ?? prev.id ?? null,
      oldRow: prev,
      newRow: next,
      source: 'orders',
    });
  }

  private mapEventType(raw: string): OrderRealtimeEventType | null {
    if (raw === 'INSERT' || raw === 'UPDATE' || raw === 'DELETE') {
      return raw;
    }
    return null;
  }

  private lastQueued: OrderRealtimeChange | null = null;

  private queueChange(change: OrderRealtimeChange): void {
    this.lastQueued = change;

    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      const queued = this.lastQueued;
      this.lastQueued = null;
      if (!queued || !this.activeRole) {
        return;
      }
      this.emitChange(this.activeRole, queued);
    }, 200);
  }

  private scheduleRoleEmit(role: OrderRealtimeRole): void {
    this.queueChange({
      eventType: 'UPDATE',
      orderId: null,
      oldRow: null,
      newRow: null,
      source: 'orders',
    });
    // Ensure emit targets the requested role even mid-transition.
    if (this.activeRole !== role) {
      return;
    }
  }

  private emitChange(role: OrderRealtimeRole, change: OrderRealtimeChange): void {
    this.log('emitting debounced change', { role, event: change.eventType, orderId: change.orderId });
    this.zone.run(() => {
      switch (role) {
        case 'admin':
          this.adminChangesSubject.next(change);
          break;
        case 'user':
          this.userChangesSubject.next(change);
          break;
        case 'courier':
          this.courierChangesSubject.next();
          break;
      }
    });
  }

  private log(message: string, data?: unknown): void {
    if (environment.production) {
      return;
    }
    if (data !== undefined) {
      console.info(`[OrderRealtime] ${message}`, data);
    } else {
      console.info(`[OrderRealtime] ${message}`);
    }
  }
}
