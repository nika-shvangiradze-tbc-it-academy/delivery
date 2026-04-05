import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-delivery-footer',
  imports: [TranslatePipe],
  templateUrl: './delivery-footer.html',
  styleUrl: './delivery-footer.scss',
})
export class DeliveryFooter {
  readonly currentYear = new Date().getFullYear();

  readonly phoneDisplay = '551 000 000';
  readonly phoneHref = 'tel:+995551000000';

  readonly email = 'info@delivery.ge';
  readonly emailHref = 'mailto:info@delivery.ge';


  readonly social = {
    tiktok: 'https://www.tiktok.com/',
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
  } as const;
}
