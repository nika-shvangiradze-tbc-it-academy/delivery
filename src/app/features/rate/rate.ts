import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-rate',
  imports: [TranslatePipe],
  templateUrl: './rate.html',
  styleUrl: './rate.scss',
})
export class Rate {}
