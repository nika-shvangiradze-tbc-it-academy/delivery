import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PageLoaderService {
  readonly isLoading = signal(true);

  private loaderTimeoutId: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    // Hide as soon as the document is interactive — do not wait on window.load
    // (images/fonts) or invent artificial delay that blocks LCP.
    const hide = () => {
      if (this.loaderTimeoutId) {
        clearTimeout(this.loaderTimeoutId);
      }
      this.loaderTimeoutId = setTimeout(() => this.isLoading.set(false), 0);
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      hide();
      return;
    }

    document.addEventListener('DOMContentLoaded', hide, { once: true });
  }

  destroy(): void {
    if (this.loaderTimeoutId) {
      clearTimeout(this.loaderTimeoutId);
    }
  }
}
