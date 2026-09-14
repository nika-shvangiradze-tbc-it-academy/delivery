import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-items',
  imports: [TranslatePipe],
  templateUrl: './items.html',
  styleUrl: './items.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Items {}
