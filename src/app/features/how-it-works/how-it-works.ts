import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { AuthService } from '../../core/services/auth.service';

export type HowItWorksIcon = 'order' | 'pickup' | 'transit' | 'delivered';

export interface HowItWorksStep {
  number: string;
  titleKey: string;
  descriptionKey: string;
  icon: HowItWorksIcon;
}

@Component({
  selector: 'app-how-it-works',
  imports: [TranslatePipe],
  templateUrl: './how-it-works.html',
  styleUrl: './how-it-works.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HowItWorks implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('sectionRoot') private sectionRoot?: ElementRef<HTMLElement>;
  @ViewChild('timelineRoot') private timelineRoot?: ElementRef<HTMLElement>;
  @ViewChild('mobileRoute') private mobileRoute?: ElementRef<HTMLElement>;

  readonly steps: readonly HowItWorksStep[] = [
    {
      number: '01',
      titleKey: 'howItWorks.step1Title',
      descriptionKey: 'howItWorks.step1Desc',
      icon: 'order',
    },
    {
      number: '02',
      titleKey: 'howItWorks.step2Title',
      descriptionKey: 'howItWorks.step2Desc',
      icon: 'pickup',
    },
    {
      number: '03',
      titleKey: 'howItWorks.step3Title',
      descriptionKey: 'howItWorks.step3Desc',
      icon: 'transit',
    },
    {
      number: '04',
      titleKey: 'howItWorks.step4Title',
      descriptionKey: 'howItWorks.step4Desc',
      icon: 'delivered',
    },
  ];

  private io?: IntersectionObserver;
  private motionMq?: MediaQueryList;
  private narrowMq?: MediaQueryList;
  private resizeObserver?: ResizeObserver;
  private stopsRaf = 0;

  private readonly onMotionChange = (): void => this.applyReducedMotionClass();
  private readonly onViewportChange = (): void => this.scheduleMobileStops();
  private readonly onWindowResize = (): void => this.scheduleMobileStops();

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.narrowMq = window.matchMedia('(max-width: 768px)');
    this.motionMq.addEventListener('change', this.onMotionChange);
    this.narrowMq.addEventListener('change', this.onViewportChange);
    window.addEventListener('resize', this.onWindowResize, { passive: true });

    this.applyReducedMotionClass();
    this.setupEntranceObserver();
    this.setupResizeObserver();
    this.scheduleMobileStops();

    this.destroyRef.onDestroy(() => {
      this.motionMq?.removeEventListener('change', this.onMotionChange);
      this.narrowMq?.removeEventListener('change', this.onViewportChange);
      window.removeEventListener('resize', this.onWindowResize);
      this.io?.disconnect();
      this.resizeObserver?.disconnect();
      cancelAnimationFrame(this.stopsRaf);
    });
  }

  async onCreateOrder(): Promise<void> {
    const role = this.auth.profile()?.role;
    if (role === 'admin') {
      await this.router.navigateByUrl('/admin');
      return;
    }
    if (role === 'courier') {
      await this.router.navigateByUrl('/courier');
      return;
    }

    if (!this.auth.isAuthenticated()) {
      await this.router.navigate(['/login'], {
        queryParams: {
          returnUrl: this.router.createUrlTree(['/create-order']).toString(),
        },
      });
      return;
    }

    await this.router.navigate(['/create-order']);
  }

  onCardEnter(index: number): void {
    const root = this.sectionRoot?.nativeElement;
    if (!root) {
      return;
    }
    root.dataset['hoverStep'] = String(index);
  }

  onCardLeave(): void {
    const root = this.sectionRoot?.nativeElement;
    if (!root) {
      return;
    }
    delete root.dataset['hoverStep'];
  }

  private applyReducedMotionClass(): void {
    const root = this.sectionRoot?.nativeElement;
    if (!root) {
      return;
    }
    root.classList.toggle('hiw--reduced', !!this.motionMq?.matches);
  }

  private setupEntranceObserver(): void {
    const target = this.sectionRoot?.nativeElement;
    if (!target || typeof IntersectionObserver === 'undefined') {
      target?.classList.add('hiw--in');
      this.scheduleMobileStops();
      return;
    }

    this.io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) {
          return;
        }
        target.classList.add('hiw--in');
        this.scheduleMobileStops();
        this.io?.disconnect();
        this.io = undefined;
      },
      { threshold: 0.22, rootMargin: '0px 0px -8% 0px' },
    );

    this.io.observe(target);
  }

  private setupResizeObserver(): void {
    const timeline = this.timelineRoot?.nativeElement;
    if (!timeline || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.scheduleMobileStops());
    this.resizeObserver.observe(timeline);
  }

  private scheduleMobileStops(): void {
    cancelAnimationFrame(this.stopsRaf);
    this.stopsRaf = requestAnimationFrame(() => this.updateMobileStops());
  }

  /** Align mobile parcel pauses to the exact center of each timeline bullet. */
  private updateMobileStops(): void {
    const route = this.mobileRoute?.nativeElement;
    const timeline = this.timelineRoot?.nativeElement;
    if (!route || !timeline) {
      return;
    }

    if (!this.narrowMq?.matches) {
      return;
    }

    const bullets = timeline.querySelectorAll<HTMLElement>('.hiw__step-bullet');
    if (bullets.length < 4) {
      return;
    }

    const routeRect = route.getBoundingClientRect();
    const routeHeight = routeRect.height;
    if (routeHeight < 8) {
      return;
    }

    const centers: number[] = [];
    bullets.forEach((bullet) => {
      const rect = bullet.getBoundingClientRect();
      centers.push(rect.top + rect.height / 2 - routeRect.top);
    });

    centers.forEach((center, index) => {
      const n = index + 1;
      route.style.setProperty(`--hiw-s${n}`, `${center.toFixed(2)}px`);
      route.style.setProperty(`--hiw-p${n}`, `${((center / routeHeight) * 100).toFixed(3)}%`);
    });
  }
}
