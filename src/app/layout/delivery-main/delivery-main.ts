import { Component } from '@angular/core';
import { DeliveryHeader } from '../delivery-header/delivery-header';
import { Landing } from '../../features/landing/landing';
import { Pricing } from '../../features/pricing/pricing';
import { Items } from '../../features/items/items';
import { Priorites } from '../../features/priorites/priorites';
import { About } from '../../features/about/about';
import { Rate } from '../../features/rate/rate';
import { DeliveryFooter } from '../delivery-footer/delivery-footer';
import { Size } from '../../features/size/size';

@Component({
  selector: 'app-delivery-main',
  imports: [DeliveryHeader, Landing, Pricing, Items, Priorites, About, Rate, DeliveryFooter, Size],
  templateUrl: './delivery-main.html',
  styleUrl: './delivery-main.scss',
})
export class DeliveryMain {}
