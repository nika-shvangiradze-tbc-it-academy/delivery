import { Component } from '@angular/core';
import { TranslatePipe } from '../../core/pipes/t.pipe';

@Component({
  selector: 'app-priorites',
  imports: [TranslatePipe],
  templateUrl: './priorites.html',
  styleUrl: './priorites.scss',
})
export class Priorites {}
