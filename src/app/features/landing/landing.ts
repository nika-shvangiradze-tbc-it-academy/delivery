import {
  AfterViewInit,
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
})
export class Landing implements AfterViewInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('heroRoot') private heroRoot?: ElementRef<HTMLElement>;
  @ViewChild('heroViz') private heroViz?: ElementRef<HTMLElement>;
  @ViewChild('heroCta') private heroCta?: ElementRef<HTMLButtonElement>;

  readonly contactModalOpen = signal(false);

  readonly phoneDisplay = '551 000 000';
  readonly phoneHref = 'tel:+995551000000';
  readonly email = 'info@delivery.ge';
  readonly emailHref = 'mailto:info@delivery.ge';

  private rafId = 0;
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;
  private ctaTX = 0;
  private ctaTY = 0;
  private ctaCX = 0;
  private ctaCY = 0;
  private parallaxActive = false;
  private reducedMotion = false;
  private motionMq?: MediaQueryList;
  private widthMq?: MediaQueryList;
  private coarseMq?: MediaQueryList;

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
    this.startLoop();

    requestAnimationFrame(() => {
      this.heroRoot?.nativeElement.classList.add('main__hero--ready');
    });

    this.destroyRef.onDestroy(() => {
      this.motionMq?.removeEventListener('change', this.onFlagChange);
      this.widthMq?.removeEventListener('change', this.onFlagChange);
      this.coarseMq?.removeEventListener('change', this.onFlagChange);
    });
  }

  ngOnDestroy(): void {
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

  onPointerMove(event: PointerEvent): void {
    if (!this.parallaxActive || !this.heroViz) {
      return;
    }

    const rect = this.heroViz.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    this.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    this.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  }

  onPointerLeave(): void {
    this.targetX = 0;
    this.targetY = 0;
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
  }

  onCtaLeave(): void {
    this.ctaTX = 0;
    this.ctaTY = 0;
  }

  private refreshFlags(): void {
    this.reducedMotion = !!this.motionMq?.matches;
    const narrow = !!this.widthMq?.matches;
    const coarse = !!this.coarseMq?.matches;
    this.parallaxActive = !this.reducedMotion && !narrow && !coarse;

    if (!this.parallaxActive) {
      this.targetX = 0;
      this.targetY = 0;
      this.currentX = 0;
      this.currentY = 0;
    }

    const root = this.heroRoot?.nativeElement;
    root?.classList.toggle('main__hero--reduced', this.reducedMotion);
    root?.classList.toggle('main__hero--static', !this.parallaxActive);
    this.applyParallax();
  }

  private startLoop(): void {
    const tick = (): void => {
      const ease = this.parallaxActive ? 0.08 : 0.16;
      this.currentX += (this.targetX - this.currentX) * ease;
      this.currentY += (this.targetY - this.currentY) * ease;
      this.ctaCX += (this.ctaTX - this.ctaCX) * 0.16;
      this.ctaCY += (this.ctaTY - this.ctaCY) * 0.16;
      this.applyParallax();
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private applyParallax(): void {
    const viz = this.heroViz?.nativeElement;
    const cta = this.heroCta?.nativeElement;
    if (!viz) {
      return;
    }

    const mx = this.currentX;
    const my = this.currentY;

    // Subtle tilt + layered depth (px)
    viz.style.setProperty('--rx', `${(-my * 1).toFixed(3)}deg`);
    viz.style.setProperty('--ry', `${(mx * 1.5).toFixed(3)}deg`);
    viz.style.setProperty('--p0', `${(mx * 2).toFixed(2)}px, ${(my * 2).toFixed(2)}px`);
    viz.style.setProperty('--p1', `${(mx * 3).toFixed(2)}px, ${(my * 3).toFixed(2)}px`);
    viz.style.setProperty('--p2', `${(mx * 4).toFixed(2)}px, ${(my * 4).toFixed(2)}px`);
    viz.style.setProperty('--p3', `${(mx * 6).toFixed(2)}px, ${(my * 5).toFixed(2)}px`);
    viz.style.setProperty('--p4', `${(mx * 8).toFixed(2)}px, ${(my * 6).toFixed(2)}px`);

    if (cta) {
      cta.style.setProperty('--cta-x', `${this.ctaCX.toFixed(2)}px`);
      cta.style.setProperty('--cta-y', `${this.ctaCY.toFixed(2)}px`);
    }
  }
}
