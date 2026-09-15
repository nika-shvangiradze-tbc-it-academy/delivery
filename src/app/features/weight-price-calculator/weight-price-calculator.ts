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
import {
  WEIGHT_QUICK_VALUES,
  WEIGHT_TARIFF_BANDS,
  WEIGHT_TARIFF_MAX_KG,
  calculateWeightPrice,
  formatWeightPrice,
  weightBandSpan,
} from '../../core/constants/weight-tariffs';

const WEIGHT_STEP = 0.5;
const MAX_INPUT_KG = 999;

@Component({
  selector: 'app-weight-price-calculator',
  imports: [TranslatePipe],
  templateUrl: './weight-price-calculator.html',
  styleUrl: './weight-price-calculator.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WeightPriceCalculator {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly bands = WEIGHT_TARIFF_BANDS;
  readonly quickWeights = WEIGHT_QUICK_VALUES;
  readonly maxKg = WEIGHT_TARIFF_MAX_KG;

  /** Raw input so intermediate values like "12." remain editable. */
  readonly weightInput = signal('');

  readonly parsedWeight = computed(() => this.parseWeight(this.weightInput()));

  readonly quote = computed(() => calculateWeightPrice(this.parsedWeight()));

  readonly priceDisplay = computed(() => {
    const price = this.quote().price;
    return price === null ? null : formatWeightPrice(price);
  });

  readonly activeBandIndex = computed(() => {
    const band = this.quote().band;
    if (!band) {
      return -1;
    }
    return this.bands.indexOf(band);
  });

  /** 0–100 progress along the 0–50 kg scale for the marker. */
  readonly markerPercent = computed(() => {
    const weight = this.quote().status === 'ok' || this.quote().status === 'over_limit'
      ? this.quote().weight
      : null;
    if (weight === null || weight <= 0) {
      return 0;
    }
    return Math.min(100, (Math.min(weight, this.maxKg) / this.maxKg) * 100);
  });

  bandFlex(band: (typeof WEIGHT_TARIFF_BANDS)[number]): number {
    return weightBandSpan(band);
  }

  onWeightInput(raw: string): void {
    const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '');
    const parts = cleaned.split('.');
    const normalized =
      parts.length <= 1 ? cleaned : `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
    this.weightInput.set(normalized);
  }

  decreaseWeight(): void {
    const current = this.parsedWeight();
    const next = current === null || current <= 0 ? WEIGHT_STEP : Math.max(WEIGHT_STEP, +(current - WEIGHT_STEP).toFixed(2));
    this.weightInput.set(this.formatInput(next));
  }

  increaseWeight(): void {
    const current = this.parsedWeight();
    const base = current === null || current <= 0 ? 0 : current;
    const next = Math.min(MAX_INPUT_KG, +(base + WEIGHT_STEP).toFixed(2));
    this.weightInput.set(this.formatInput(next));
  }

  setQuickWeight(kg: number): void {
    this.weightInput.set(this.formatInput(kg));
  }

  isQuickActive(kg: number): boolean {
    return this.parsedWeight() === kg;
  }

  async onCreateOrder(): Promise<void> {
    if (this.quote().status !== 'ok') {
      return;
    }

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
          returnUrl: this.router.createUrlTree(['/create-order']).toString(),
        },
      });
      return;
    }

    await this.router.navigate(['/create-order']);
  }

  async onContactForHeavy(): Promise<void> {
    // Reuse in-page size contact affordance when present; otherwise scroll to contact prompt.
    const contactBtn = document.querySelector<HTMLButtonElement>('.size__contact-button');
    if (contactBtn) {
      contactBtn.click();
      return;
    }
    document.getElementById('size')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  private parseWeight(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '.') {
      return null;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  private formatInput(value: number): string {
    return Number.isInteger(value) ? String(value) : String(value);
  }
}
