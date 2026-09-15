import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PageLoaderService {
  /** Kept for compatibility; never blocks content paint. */
  readonly isLoading = signal(false);

  init(): void {
    this.isLoading.set(false);
  }

  destroy(): void {
    // no-op
  }
}
