import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ImageLoaderService } from './core/services/image-loader.service';
import { I18nService } from './core/services/i18n.service';
import { OrderRealtimeService } from './core/services/order-realtime.service';
import { PageLoaderService } from './core/services/page-loader.service';
import { SeoService } from './core/services/seo.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit, OnDestroy {
  constructor(
    private readonly pageLoaderService: PageLoaderService,
    private readonly imageLoaderService: ImageLoaderService,
    private readonly i18nService: I18nService,
    private readonly seoService: SeoService,
    /** Eagerly construct so auth-driven Realtime channels bind at app start. */
    _orderRealtime: OrderRealtimeService,
  ) {}

  ngOnInit(): void {
    void this.i18nService.init();
    this.seoService.init();
    this.pageLoaderService.init();
    this.imageLoaderService.init();
  }

  ngOnDestroy(): void {
    this.pageLoaderService.destroy();
    this.imageLoaderService.destroy();
  }
}
