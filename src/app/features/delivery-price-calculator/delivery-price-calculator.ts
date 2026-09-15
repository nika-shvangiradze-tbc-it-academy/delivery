import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { AuthService } from '../../core/services/auth.service';
import { CALCULATOR_CITIES, calculateDeliveryPrice } from '../../core/constants/delivery-tariffs';

const DRAFT_STORAGE_KEY = 'deliveryCalculatorDraft';

export interface DeliveryCalculatorDraft {
  pickup_city: string;
  delivery_city: string;
  parcel_count: number;
}

@Component({
  selector: 'app-delivery-price-calculator',
  imports: [TranslatePipe],
  templateUrl: './delivery-price-calculator.html',
  styleUrl: './delivery-price-calculator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryPriceCalculator {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly cities = CALCULATOR_CITIES;

  readonly originCity = signal('');
  readonly destinationCity = signal('');
  readonly parcelCount = signal(1);
  readonly routeAnimKey = signal(0);

  readonly quote = computed(() =>
    calculateDeliveryPrice(this.originCity(), this.destinationCity(), this.parcelCount()),
  );

  readonly priceDisplay = computed(() => {
    const total = this.quote().totalPrice;
    return total === null ? null : String(total);
  });

  onOriginChange(value: string): void {
    this.originCity.set(value);
    this.replayRouteAnimation();
  }

  onDestinationChange(value: string): void {
    this.destinationCity.set(value);
    this.replayRouteAnimation();
  }

  decreaseParcels(): void {
    this.parcelCount.update((n) => Math.max(1, n - 1));
  }

  increaseParcels(): void {
    this.parcelCount.update((n) => n + 1);
  }

  async onCreateOrder(): Promise<void> {
    const quote = this.quote();
    if (quote.status !== 'ok' || !quote.origin || !quote.destination) {
      return;
    }

    const draft: DeliveryCalculatorDraft = {
      pickup_city: quote.origin,
      delivery_city: quote.destination,
      parcel_count: quote.parcelCount,
    };
    this.persistDraft(draft);

    const queryParams = {
      pickup_city: draft.pickup_city,
      delivery_city: draft.delivery_city,
      parcel_count: String(draft.parcel_count),
    };

    const role = this.auth.profile()?.role;
    if (role === 'admin') {
      await this.router.navigateByUrl('/admin');
      return;
    }
    if (role === 'courier') {
      await this.router.navigateByUrl('/courier');
      return;
    }

    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/login'], {
        queryParams: {
          returnUrl: this.router.createUrlTree(['/create-order'], { queryParams }).toString(),
        },
      });
      return;
    }

    await this.router.navigate(['/create-order'], { queryParams });
  }

  private replayRouteAnimation(): void {
    this.routeAnimKey.update((k) => k + 1);
  }

  private persistDraft(draft: DeliveryCalculatorDraft): void {
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Ignore quota / private-mode failures — query params still carry values.
    }
  }

  static readDraft(): DeliveryCalculatorDraft | null {
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<DeliveryCalculatorDraft>;
      if (
        typeof parsed.pickup_city !== 'string' ||
        typeof parsed.delivery_city !== 'string' ||
        typeof parsed.parcel_count !== 'number'
      ) {
        return null;
      }
      return {
        pickup_city: parsed.pickup_city,
        delivery_city: parsed.delivery_city,
        parcel_count: Math.max(1, Math.floor(parsed.parcel_count)),
      };
    } catch {
      return null;
    }
  }

  static clearDraft(): void {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // no-op
    }
  }
}
