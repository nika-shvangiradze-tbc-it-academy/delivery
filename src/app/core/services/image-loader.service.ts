import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ImageLoaderService {
  private cleanups: Array<() => void> = [];
  private imageObserver: MutationObserver | null = null;

  init(): void {
    this.bindImageLoaders();
    this.observeNewImages();
  }

  destroy(): void {
    if (this.imageObserver) {
      this.imageObserver.disconnect();
    }

    for (const cleanup of this.cleanups) {
      cleanup();
    }

    this.cleanups = [];
  }

  private bindImageLoaders(): void {
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('img:not([data-loader-bound])')
    );

    for (const image of images) {
      image.setAttribute('data-loader-bound', 'true');
      image.classList.add('img-loading');
      image.classList.remove('img-loaded');

      const markAsLoaded = () => {
        image.classList.remove('img-loading');
        image.classList.add('img-loaded');
      };

      if (image.complete && image.naturalWidth > 0) {
        markAsLoaded();
        continue;
      }

      const onLoad = () => markAsLoaded();
      const onError = () => image.classList.remove('img-loading');

      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });

      this.cleanups.push(() => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
      });
    }
  }

  private observeNewImages(): void {
    this.imageObserver = new MutationObserver(() => {
      this.bindImageLoaders();
    });

    this.imageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}
