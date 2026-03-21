import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PageLoaderService {
  readonly isLoading = signal(true);

  private loaderTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

  init(): void {
    const hideLoader = (delayMs = 700) => {
      if (this.loaderTimeoutId) {
        clearTimeout(this.loaderTimeoutId);
      }

      this.loaderTimeoutId = setTimeout(() => {
        this.isLoading.set(false);
      }, delayMs);
    };

    if (document.readyState === 'complete') {
      hideLoader(350);
      return;
    }

    const onWindowLoad = () => hideLoader();
    window.addEventListener('load', onWindowLoad, { once: true });

    this.fallbackTimeoutId = setTimeout(() => {
      hideLoader(0);
    }, 3000);
  }

  destroy(): void {
    if (this.loaderTimeoutId) {
      clearTimeout(this.loaderTimeoutId);
    }

    if (this.fallbackTimeoutId) {
      clearTimeout(this.fallbackTimeoutId);
    }
  }
}
