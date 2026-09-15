import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { I18nService } from '../../core/services/i18n.service';
import {
  DELIVERY_TARIFF_MATRIX,
  TARIFF_CARD_DESTINATION_ORDER,
  TARIFF_CARD_META,
  TARIFF_CITIES,
  formatTariffRouteLine,
  type TariffCity,
} from '../../core/constants/delivery-tariffs';

export interface RateCardView {
  from: TariffCity;
  headingKey: string;
  imageWebp: string;
  imageJpg: string;
  imageAlt: string;
  routes: string[];
}

@Component({
  selector: 'app-rate',
  imports: [TranslatePipe],
  templateUrl: './rate.html',
  styleUrl: './rate.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Rate {
  private readonly i18n = inject(I18nService);

  readonly cards = computed<RateCardView[]>(() => {
    const lang = this.i18n.currentLanguage();
    return TARIFF_CITIES.map((from) => {
      const meta = TARIFF_CARD_META[from];
      const destinations = TARIFF_CARD_DESTINATION_ORDER[from];
      return {
        from,
        headingKey: meta.headingKey,
        imageWebp: meta.imageWebp,
        imageJpg: meta.imageJpg,
        imageAlt: meta.imageAlt,
        routes: destinations.map((to) => {
          const price = DELIVERY_TARIFF_MATRIX[from][to];
          return formatTariffRouteLine(from, to, price ?? 0, lang);
        }),
      };
    });
  });
}
