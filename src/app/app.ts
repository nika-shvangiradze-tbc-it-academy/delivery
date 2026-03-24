import { Component, OnDestroy, OnInit, Signal } from '@angular/core';
import { ImageLoaderService } from './core/services/image-loader.service';
import { I18nService } from './core/services/i18n.service';
import { PageLoaderService } from './core/services/page-loader.service';
import { DeliveryMain } from './layout/delivery-main/delivery-main';



@Component({
  selector: 'app-root',
  imports: [DeliveryMain],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  readonly isPageLoading: Signal<boolean>;

  constructor(
    private readonly pageLoaderService: PageLoaderService,
    private readonly imageLoaderService: ImageLoaderService,
    private readonly i18nService: I18nService
  ) {
    this.isPageLoading = this.pageLoaderService.isLoading;
  }

  ngOnInit(): void {
    void this.i18nService.init();
    this.pageLoaderService.init();
    this.imageLoaderService.init();
  }

  ngOnDestroy(): void {
    this.pageLoaderService.destroy();
    this.imageLoaderService.destroy();
  }
}
