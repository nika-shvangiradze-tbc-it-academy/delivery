import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { DeliveryFooter } from '../../../layout/delivery-footer/delivery-footer';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-privacy',
  imports: [RouterLink, TranslatePipe, DeliveryHeader, DeliveryFooter],
  templateUrl: './privacy.html',
  styleUrl: './privacy.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPage {}
