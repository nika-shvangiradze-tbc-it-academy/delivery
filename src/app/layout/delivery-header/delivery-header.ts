import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { AppLanguage } from '../../core/i18n/translations';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/services/i18n.service';

type SectionId = 'home' | 'about' | 'pricing' | 'cities' | 'contact';

@Component({
  selector: 'app-delivery-header',
  imports: [TranslatePipe, RouterLink, RouterLinkActive],
  templateUrl: './delivery-header.html',
  styleUrl: './delivery-header.scss',
})
export class DeliveryHeader implements AfterViewInit, OnDestroy {
  private readonly i18nService = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  isMenuOpen = false;
  activeSection: SectionId = 'home';
  readonly currentLanguage = this.i18nService.currentLanguage;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isAdmin = this.auth.isAdmin;
  readonly isCourier = this.auth.isCourier;
  readonly isReady = this.auth.isReady;

  private readonly sectionIds: SectionId[] = ['home', 'about', 'pricing', 'cities', 'contact'];
  private sectionElements: HTMLElement[] = [];
  private rafId = 0;

  async onLanguageChange(language: AppLanguage): Promise<void> {
    await this.i18nService.setLanguage(language);
  }

  private readonly onScroll = (): void => {
    if (this.rafId) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = 0;
      this.updateActiveSection();
    });
  };

  ngAfterViewInit(): void {
    this.refreshSections();
    if (this.sectionElements.length === 0) return;

    this.updateActiveSection();
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
  }

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu(): void {
    this.isMenuOpen = false;
  }

  async onNavClick(sectionId: SectionId, event: Event): Promise<void> {
    event.preventDefault();
    this.activeSection = sectionId;
    this.closeMenu();

    if (this.router.url.split('#')[0] !== '/') {
      await this.router.navigateByUrl(`/#${sectionId}`);
      setTimeout(() => {
        this.refreshSections();
        this.scrollToSection(sectionId);
      }, 80);
      return;
    }

    this.scrollToSection(sectionId);
  }

  async onLogout(): Promise<void> {
    this.closeMenu();
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }

  private refreshSections(): void {
    this.sectionElements = this.sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
  }

  private updateActiveSection(): void {
    if (this.sectionElements.length === 0) return;

    const headerEl = document.querySelector<HTMLElement>('.header');
    const headerBottom = headerEl?.getBoundingClientRect().bottom;
    const headerHeight = headerEl?.getBoundingClientRect().height ?? 88;
    const markerY = window.scrollY + (headerBottom ?? headerHeight) + 8;

    let closestId: SectionId = 'home';
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const el of this.sectionElements) {
      const id = el.id as SectionId;
      const topY = window.scrollY + el.getBoundingClientRect().top;
      const bottomY = topY + el.offsetHeight;

      if (markerY >= topY && markerY < bottomY) {
        this.activeSection = id;
        return;
      }

      const dist = Math.abs(markerY - topY);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestId = id;
      }
    }

    this.activeSection = closestId;
  }

  private scrollToSection(sectionId: SectionId): void {
    const el = document.getElementById(sectionId);
    if (!el) return;

    history.replaceState(null, '', `/#${sectionId}`);

    const headerEl = document.querySelector<HTMLElement>('.header');
    const headerBottom = headerEl?.getBoundingClientRect().bottom;
    const headerHeight = headerEl?.getBoundingClientRect().height ?? 88;

    const top =
      window.scrollY + el.getBoundingClientRect().top - (headerBottom ?? headerHeight) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}
