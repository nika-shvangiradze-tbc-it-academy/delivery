import { ChangeDetectionStrategy, Component, HostListener, signal } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import {
  WEIGHT_TARIFF_BANDS,
  formatWeightPrice,
} from '../../core/constants/weight-tariffs';
import { WeightPriceCalculator } from '../weight-price-calculator/weight-price-calculator';

@Component({
  selector: 'app-size',
  imports: [TranslatePipe, WeightPriceCalculator],
  templateUrl: './size.html',
  styleUrl: './size.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Size {
  readonly weightTariffs = WEIGHT_TARIFF_BANDS;
  readonly formatPrice = formatWeightPrice;

  readonly contactModalOpen = signal(false);

  readonly phoneDisplay = '551 099 081';
  readonly phoneHref = 'tel:+995551099081';
  readonly email = 'location@gmail.com';
  readonly emailHref = 'mailto:location@gmail.com';

  openContactModal(): void {
    this.contactModalOpen.set(true);
  }

  closeContactModal(): void {
    this.contactModalOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.contactModalOpen()) {
      this.closeContactModal();
    }
  }
}
