import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-landing',
  imports: [TranslatePipe],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing implements AfterViewInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('heroRoot') private heroRoot?: ElementRef<HTMLElement>;
  @ViewChild('heroViz') private heroViz?: ElementRef<HTMLElement>;
  @ViewChild('heroScene') private heroScene?: ElementRef<HTMLElement>;
  @ViewChild('heroFx') private heroFx?: ElementRef<SVGSVGElement>;
  @ViewChild('heroCta') private heroCta?: ElementRef<HTMLButtonElement>;

  readonly contactModalOpen = signal(false);

  readonly phoneDisplay = '551 000 000';
  readonly phoneHref = 'tel:+995551000000';
  readonly email = 'info@delivery.ge';
  readonly emailHref = 'mailto:info@delivery.ge';

  private rafId = 0;
  private ctaTX = 0;
  private ctaTY = 0;
  private ctaCX = 0;
  private ctaCY = 0;
  private vizTX = 0;
  private vizTY = 0;
  private vizCX = 0;
  private vizCY = 0;
  private reducedMotion = false;
  private parallaxActive = false;
  private inView = true;
  private loopRunning = false;
  private motionMq?: MediaQueryList;
  private widthMq?: MediaQueryList;
  private coarseMq?: MediaQueryList;
  private io?: IntersectionObserver;

  private readonly onFlagChange = (): void => this.refreshFlags();

  ngAfterViewInit(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    this.motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.widthMq = window.matchMedia('(max-width: 900px)');
    this.coarseMq = window.matchMedia('(pointer: coarse)');

    this.motionMq.addEventListener('change', this.onFlagChange);
    this.widthMq.addEventListener('change', this.onFlagChange);
    this.coarseMq.addEventListener('change', this.onFlagChange);

    this.refreshFlags();
    this.setupIntersection();
    this.startLoop();

    requestAnimationFrame(() => {
      this.heroRoot?.nativeElement.classList.add('main__hero--ready');
    });

    this.destroyRef.onDestroy(() => {
      this.motionMq?.removeEventListener('change', this.onFlagChange);
      this.widthMq?.removeEventListener('change', this.onFlagChange);
      this.coarseMq?.removeEventListener('change', this.onFlagChange);
      this.io?.disconnect();
    });
  }

  ngOnDestroy(): void {
    this.loopRunning = false;
    cancelAnimationFrame(this.rafId);
  }

  openContactModal(): void {
    this.contactModalOpen.set(true);
  }

  closeContactModal(): void {
    this.contactModalOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.contactModalOpen()) {
      this.closeContactModal();
    }
  }

  onCtaMove(event: PointerEvent): void {
    if (this.reducedMotion || !this.heroCta) {
      return;
    }

    const el = this.heroCta.nativeElement;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    this.ctaTX = Math.max(-5, Math.min(5, x * 0.14));
    this.ctaTY = Math.max(-4, Math.min(4, y * 0.14));
    this.startLoop();
  }

  onCtaLeave(): void {
    this.ctaTX = 0;
    this.ctaTY = 0;
    this.startLoop();
  }

  onVizMove(event: PointerEvent): void {
    if (!this.parallaxActive || !this.heroViz) {
      return;
    }

    const rect = this.heroViz.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    this.vizTX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    this.vizTY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    this.startLoop();
  }

  onVizLeave(): void {
    this.vizTX = 0;
    this.vizTY = 0;
    this.startLoop();
  }

  private refreshFlags(): void {
    this.reducedMotion = !!this.motionMq?.matches;
    const narrow = !!this.widthMq?.matches;
    const coarse = !!this.coarseMq?.matches;
    this.parallaxActive = !this.reducedMotion && !narrow && !coarse;

    const root = this.heroRoot?.nativeElement;
    const viz = this.heroViz?.nativeElement;

    root?.classList.toggle('main__hero--reduced', this.reducedMotion);
    viz?.classList.toggle('hero-viz--reduced', this.reducedMotion);

    if (!this.parallaxActive) {
      this.vizTX = 0;
      this.vizTY = 0;
      this.vizCX = 0;
      this.vizCY = 0;
      this.applyParallax();
    }

    this.syncSvgPlayback();
    this.startLoop();
  }

  private setupIntersection(): void {
    const target = this.heroViz?.nativeElement;
    if (!target || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.inView = !!entry?.isIntersecting;
        this.heroViz?.nativeElement.classList.toggle('hero-viz--paused', !this.inView);
        this.syncSvgPlayback();
        if (this.inView) {
          this.startLoop();
        }
      },
      { threshold: 0.12 },
    );

    this.io.observe(target);
  }

  private syncSvgPlayback(): void {
    const svg = this.heroFx?.nativeElement as SVGSVGElement & {
      pauseAnimations?: () => void;
      unpauseAnimations?: () => void;
    };

    if (!svg) {
      return;
    }

    const shouldRun = this.inView && !this.reducedMotion;
    if (shouldRun) {
      svg.unpauseAnimations?.();
    } else {
      svg.pauseAnimations?.();
    }
  }

  private startLoop(): void {
    if (this.loopRunning) {
      return;
    }
    this.loopRunning = true;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.ctaCX += (this.ctaTX - this.ctaCX) * 0.16;
    this.ctaCY += (this.ctaTY - this.ctaCY) * 0.16;

    if (this.parallaxActive && this.inView && !this.reducedMotion) {
      this.vizCX += (this.vizTX - this.vizCX) * 0.08;
      this.vizCY += (this.vizTY - this.vizCY) * 0.08;
    } else {
      this.vizCX += (0 - this.vizCX) * 0.14;
      this.vizCY += (0 - this.vizCY) * 0.14;
    }

    this.applyCta();
    this.applyParallax();

    const settling =
      Math.abs(this.ctaTX - this.ctaCX) > 0.04 ||
      Math.abs(this.ctaTY - this.ctaCY) > 0.04 ||
      Math.abs(this.vizTX - this.vizCX) > 0.04 ||
      Math.abs(this.vizTY - this.vizCY) > 0.04;

    const keepForParallax = this.parallaxActive && this.inView && !this.reducedMotion;

    if (settling || keepForParallax) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    this.loopRunning = false;
  };

  private applyCta(): void {
    const cta = this.heroCta?.nativeElement;
    if (!cta) {
      return;
    }
    cta.style.setProperty('--cta-x', `${this.ctaCX.toFixed(2)}px`);
    cta.style.setProperty('--cta-y', `${this.ctaCY.toFixed(2)}px`);
  }

  private applyParallax(): void {
    const scene = this.heroScene?.nativeElement;
    if (!scene) {
      return;
    }

    const mx = this.vizCX;
    const my = this.vizCY;

    scene.style.setProperty('--px', `${(mx * 2).toFixed(2)}px`);
    scene.style.setProperty('--py', `${(my * 2).toFixed(2)}px`);
    scene.style.setProperty('--fx', `${(mx * 6).toFixed(2)}px`);
    scene.style.setProperty('--fy', `${(my * 5).toFixed(2)}px`);
    scene.style.setProperty('--rx', `${(-my * 0.7).toFixed(3)}deg`);
    scene.style.setProperty('--ry', `${(mx * 0.9).toFixed(3)}deg`);
  }
}
