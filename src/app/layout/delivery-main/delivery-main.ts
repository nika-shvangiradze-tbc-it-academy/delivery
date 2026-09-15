import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DeliveryHeader } from '../delivery-header/delivery-header';
import { Landing } from '../../features/landing/landing';
import { Pricing } from '../../features/pricing/pricing';
import { Items } from '../../features/items/items';
import { Priorites } from '../../features/priorites/priorites';
import { About } from '../../features/about/about';
import { Rate } from '../../features/rate/rate';
import { DeliveryPriceCalculator } from '../../features/delivery-price-calculator/delivery-price-calculator';
import { DeliveryFooter } from '../delivery-footer/delivery-footer';
import { Size } from '../../features/size/size';
import { HowItWorks } from '../../features/how-it-works/how-it-works';

@Component({
  selector: 'app-delivery-main',
  imports: [
    DeliveryHeader,
    Landing,
    Pricing,
    Items,
    Priorites,
    About,
    Rate,
    DeliveryPriceCalculator,
    DeliveryFooter,
    Size,
    HowItWorks,
  ],
  templateUrl: './delivery-main.html',
  styleUrl: './delivery-main.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryMain {}
