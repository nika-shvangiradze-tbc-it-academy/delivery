import { Component } from '@angular/core';
import { DeliveryMain } from './layout/delivery-main/delivery-main';



@Component({
  selector: 'app-root',
  imports: [DeliveryMain],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
