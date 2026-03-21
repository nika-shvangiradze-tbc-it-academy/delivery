import { Component } from '@angular/core';

@Component({
  selector: 'app-delivery-header',
  imports: [],
  templateUrl: './delivery-header.html',
  styleUrl: './delivery-header.scss',
})
export class DeliveryHeader {
  isMenuOpen = false;

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu(): void {
    this.isMenuOpen = false;
  }
}
