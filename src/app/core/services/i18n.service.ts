import { Injectable, signal } from '@angular/core';
import i18next from 'i18next';
import { AppLanguage, translationResources } from '../i18n/translations';

const STORAGE_KEY = 'app-language';

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly currentLanguage = signal<AppLanguage>('en');

  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    const savedLanguage = this.getInitialLanguage();

    await i18next.init({
      lng: savedLanguage,
      fallbackLng: 'en',
      resources: translationResources,
      interpolation: { escapeValue: false },
    });

    this.initialized = true;
    this.currentLanguage.set(savedLanguage);
    this.updateDocumentLanguage(savedLanguage);
  }

  t(key: string): string {
    return i18next.t(key);
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

    const browserLanguage = navigator.language.toLowerCase();
    return browserLanguage.startsWith('ka') ? 'ka' : 'en';
  }

  private updateDocumentLanguage(language: AppLanguage): void {
    document.documentElement.lang = language;
  }
}
