import { Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

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
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);
  private started = false;

  init(): void {
    if (this.started || typeof document === 'undefined') {
      return;
    }
    this.started = true;

    this.applyForUrl(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.applyForUrl(event.urlAfterRedirects));
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
