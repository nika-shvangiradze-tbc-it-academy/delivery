import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { ContactModalService } from '../../core/services/contact-modal.service';

@Component({
  selector: 'app-contact-modal',
  imports: [TranslatePipe],
  templateUrl: './contact-modal.html',
  styleUrl: './contact-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactModal {
  private readonly contactModal = inject(ContactModalService);

  readonly isOpen = this.contactModal.isOpen;

  readonly phoneDisplay = '551 000 000';
  readonly phoneHref = 'tel:+995551000000';
  readonly email = 'info@delivery.ge';
  readonly emailHref = 'mailto:info@delivery.ge';

  close(): void {
    this.contactModal.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.close();
    }
  }
}
