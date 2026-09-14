import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-about',
  imports: [TranslatePipe],
  templateUrl: './about.html',
  styleUrl: './about.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class About {}
