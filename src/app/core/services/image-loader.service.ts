import { Injectable } from '@angular/core';

/**
 * Lightweight native image hints (lazy/decoding). No MutationObserver —
 * templates should set loading/decoding where needed; CSS handles fade-in.
 */
@Injectable({ providedIn: 'root' })
export class ImageLoaderService {
  init(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const images = document.querySelectorAll<HTMLImageElement>('img:not([data-loader-bound])');
    for (const image of images) {
      this.bind(image);
    }
  }

  destroy(): void {
    // no-op — no long-lived observers
  }

  private bind(image: HTMLImageElement): void {
    image.setAttribute('data-loader-bound', 'true');

    const hasHighPriority = image.getAttribute('fetchpriority') === 'high';
    if (!hasHighPriority && !image.hasAttribute('loading')) {
      image.loading = 'lazy';
    }
    if (!image.hasAttribute('decoding')) {
      image.decoding = 'async';
    }

    // Never fade LCP / high-priority images — opacity gating delays paint.
    if (hasHighPriority || image.classList.contains('hero-viz__img')) {
      image.classList.add('img-loaded');
      return;
    }

    image.classList.add('img-loading');
    image.classList.remove('img-loaded');

    const markAsLoaded = () => {
      image.classList.remove('img-loading');
      image.classList.add('img-loaded');
    };

    if (image.complete && image.naturalWidth > 0) {
      markAsLoaded();
      return;
    }

    image.addEventListener('load', markAsLoaded, { once: true });
    image.addEventListener('error', () => image.classList.remove('img-loading'), { once: true });
  }
}
