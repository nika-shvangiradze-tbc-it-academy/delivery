import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { ContactModalService } from '../../core/services/contact-modal.service';

type SectionId = 'home' | 'about' | 'pricing' | 'cities' | 'contact';

@Component({
  selector: 'app-delivery-footer',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './delivery-footer.html',
  styleUrl: './delivery-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveryFooter implements OnDestroy {
  private readonly router = inject(Router);
  private readonly contactModal = inject(ContactModalService);
  private scrollRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

  ngOnDestroy(): void {
    if (this.scrollRetryTimer) {
      clearTimeout(this.scrollRetryTimer);
      this.scrollRetryTimer = null;
    }
  }

  async onNavClick(sectionId: SectionId, event: Event): Promise<void> {
    event.preventDefault();

    if (sectionId === 'contact') {
      this.contactModal.open();
      return;
    }

    if (this.router.url.split('#')[0] !== '/') {
      await this.router.navigateByUrl(`/#${sectionId}`);
      setTimeout(() => this.scrollToSection(sectionId), 80);
      return;
    }

    this.scrollToSection(sectionId);
  }

  private scrollToSection(sectionId: SectionId, attempt = 0): void {
    const el = document.getElementById(sectionId);

    // Deferred homepage sections may not be in the DOM yet — retry briefly.
    if (!el) {
      if (attempt < 25) {
        if (this.scrollRetryTimer) clearTimeout(this.scrollRetryTimer);
        this.scrollRetryTimer = setTimeout(() => {
          this.scrollToSection(sectionId, attempt + 1);
        }, 100);
      }
      return;
    }

    if (this.scrollRetryTimer) {
      clearTimeout(this.scrollRetryTimer);
      this.scrollRetryTimer = null;
    }

    history.replaceState(null, '', `/#${sectionId}`);

    const headerEl = document.querySelector<HTMLElement>('.header-fixed');
    const headerBottom = headerEl?.getBoundingClientRect().bottom;
    const headerHeight = headerEl?.getBoundingClientRect().height ?? 84;

    const top =
      window.scrollY + el.getBoundingClientRect().top - (headerBottom ?? headerHeight) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}
