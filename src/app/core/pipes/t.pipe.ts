import {
  ChangeDetectorRef,
  EffectRef,
  Pipe,
  PipeTransform,
  effect,
  inject,
  OnDestroy,
} from '@angular/core';
import { I18nService } from '../services/i18n.service';

@Pipe({
  name: 't',
  standalone: true,
  // Impure so language switches refresh without threading lang into every call site.
  // Marketing/feature shells use OnPush, which keeps re-eval cost bounded.
  pure: false,
})
export class TranslatePipe implements PipeTransform, OnDestroy {
  private readonly i18nService = inject(I18nService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly languageEffect: EffectRef = effect(() => {
    this.i18nService.currentLanguage();
    this.changeDetectorRef.markForCheck();
  });

  transform(key: string): string {
    return this.i18nService.t(key);
  }

  ngOnDestroy(): void {
    this.languageEffect.destroy();
  }
}
