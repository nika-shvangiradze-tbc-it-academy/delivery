import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { DeliveryFooter } from '../../../layout/delivery-footer/delivery-footer';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-terms',
  imports: [RouterLink, TranslatePipe, DeliveryHeader, DeliveryFooter],
  templateUrl: './terms.html',
  styleUrl: './terms.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsPage {}
