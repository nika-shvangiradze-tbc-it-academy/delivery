import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { AppLanguage } from '../../core/i18n/translations';
import { I18nService } from '../../core/services/i18n.service';

type SectionId = 'home' | 'about' | 'pricing' | 'cities' | 'contact';

@Component({
  selector: 'app-delivery-header',
  imports: [TranslatePipe],
  templateUrl: './delivery-header.html',
  styleUrl: './delivery-header.scss',
})
export class DeliveryHeader implements AfterViewInit, OnDestroy {
  isMenuOpen = false;
  activeSection: SectionId = 'home';
  readonly currentLanguage;

  private readonly sectionIds: SectionId[] = ['home', 'about', 'pricing', 'cities', 'contact'];
  private sectionElements: HTMLElement[] = [];

  private rafId = 0;
  constructor(private readonly i18nService: I18nService) {
    this.currentLanguage = this.i18nService.currentLanguage;
  }

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
    this.sectionElements = this.sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

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

  onNavClick(sectionId: SectionId, event: Event): void {
    event.preventDefault();
   
    this.activeSection = sectionId;
    this.scrollToSection(sectionId);
    this.closeMenu();
  }

  private updateActiveSection(): void {
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

    history.replaceState(null, '', `#${sectionId}`);

    const headerEl = document.querySelector<HTMLElement>('.header');
    const headerBottom = headerEl?.getBoundingClientRect().bottom;
    const headerHeight = headerEl?.getBoundingClientRect().height ?? 88;

    const top =
      window.scrollY + el.getBoundingClientRect().top - (headerBottom ?? headerHeight) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }
}
