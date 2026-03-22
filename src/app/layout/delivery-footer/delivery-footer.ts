import { Component } from '@angular/core';

@Component({
  selector: 'app-delivery-footer',
  imports: [],
  templateUrl: './delivery-footer.html',
  styleUrl: './delivery-footer.scss',
})
export class DeliveryFooter {
  readonly currentYear = new Date().getFullYear();

  readonly phoneDisplay = '551 099 081';
  readonly phoneHref = 'tel:+995551099081';

  readonly email = 'shvangiradzze1010@gmail.com';
  readonly emailHref = 'mailto:shvangiradzze1010@gmail.com';


  readonly social = {
    tiktok: 'https://www.tiktok.com/',
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
  } as const;
}
