import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-pricing',
  imports: [TranslatePipe],
  templateUrl: './pricing.html',
  styleUrl: './pricing.scss',
})
export class Pricing {}
