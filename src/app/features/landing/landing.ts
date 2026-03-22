import { Component, HostListener, signal } from '@angular/core';

@Component({
  selector: 'app-landing',
  imports: [],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  readonly contactModalOpen = signal(false);

  readonly phoneDisplay = '551 099 081';
  readonly phoneHref = 'tel:+995551099081';
  readonly email = 'shvangiradzze1010@gmail.com';
  readonly emailHref = 'mailto:shvangiradzze1010@gmail.com';

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
