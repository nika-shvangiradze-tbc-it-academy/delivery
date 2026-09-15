import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { NoPreloading, provideRouter, withInMemoryScrolling, withPreloading } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
      withPreloading(NoPreloading),
    ),
  ],
};
