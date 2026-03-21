import { Component } from '@angular/core';
import { DeliveryHeader } from '../delivery-header/delivery-header';
import { Landing } from '../../features/landing/landing';
import { Pricing } from '../../features/pricing/pricing';
@Component({
  selector: 'app-delivery-main',
  imports: [DeliveryHeader, Landing, Pricing],
  templateUrl: './delivery-main.html',
  styleUrl: './delivery-main.scss',
})
export class DeliveryMain {}
