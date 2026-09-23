import { Injectable, signal } from '@angular/core';
import i18next from 'i18next';
import { AppLanguage, translationResources } from '../i18n/translations';

const STORAGE_KEY = 'app-language';

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly currentLanguage = signal<AppLanguage>('ka');

  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    const savedLanguage = this.getInitialLanguage();

    await i18next.init({
      lng: savedLanguage,
      fallbackLng: 'ka',
      resources: translationResources,
      interpolation: { escapeValue: false },
      // i18next v25 prints a Locize promo via console.info unless disabled.
      showSupportNotice: false,
    });

    this.initialized = true;
    this.currentLanguage.set(savedLanguage);
    this.updateDocumentLanguage(savedLanguage);
  }

  t(key: string, options?: Record<string, unknown>): string {
    return options ? i18next.t(key, options) : i18next.t(key);
  }

  async setLanguage(language: AppLanguage): Promise<void> {
    await this.init();
    await i18next.changeLanguage(language);
    this.currentLanguage.set(language);
    localStorage.setItem(STORAGE_KEY, language);
    this.updateDocumentLanguage(language);
  }

  private getInitialLanguage(): AppLanguage {
    const storedLanguage = localStorage.getItem(STORAGE_KEY);
    if (storedLanguage === 'ka' || storedLanguage === 'en') {
      return storedLanguage;
    }

    // Georgian is the default production language.
    return 'ka';
  }

  private updateDocumentLanguage(language: AppLanguage): void {
    document.documentElement.lang = language;
  }
}
