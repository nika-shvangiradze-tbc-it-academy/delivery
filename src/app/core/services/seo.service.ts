import { Injectable, inject, effect } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { I18nService } from './i18n.service';

const PRIVATE_PREFIXES = [
  '/admin',
  '/courier',
  '/my-orders',
  '/profile',
  '/create-order',
  '/login',
  '/register',
] as const;

/**
 * Keeps robots meta in sync with the active route for this SPA.
 * Private app areas → noindex; public marketing → index,follow.
 * Also syncs document title / description with the active language.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly i18n = inject(I18nService);
  private started = false;

  private readonly languageEffect = effect(() => {
    this.i18n.currentLanguage();
    if (this.started) {
      this.applyLocalizedMeta();
    }
  });

  init(): void {
    if (this.started || typeof document === 'undefined') {
      return;
    }
    this.started = true;

    this.applyForUrl(this.router.url);
    this.applyLocalizedMeta();

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.applyForUrl(event.urlAfterRedirects));
  }

  private applyLocalizedMeta(): void {
    const pageTitle = this.i18n.t('seo.title');
    const description = this.i18n.t('seo.description');
    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: pageTitle });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:description', content: description });
  }

  private applyForUrl(rawUrl: string): void {
    const path = rawUrl.split('?')[0]?.split('#')[0] || '/';
    const isPrivate = PRIVATE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    this.meta.updateTag({
      name: 'robots',
      content: isPrivate ? 'noindex, nofollow' : 'index, follow',
    });
  }
}
