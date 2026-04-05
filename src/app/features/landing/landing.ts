import { Component, HostListener, signal } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-landing',
  imports: [TranslatePipe],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
})
export class Landing {
  readonly contactModalOpen = signal(false);

  readonly phoneDisplay = '551 000 000';
  readonly phoneHref = 'tel:+995551000000';
  readonly email = 'info@delivery.ge';
  readonly emailHref = 'mailto:info@delivery.ge';

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
