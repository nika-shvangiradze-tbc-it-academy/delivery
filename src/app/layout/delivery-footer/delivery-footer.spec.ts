import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeliveryFooter } from './delivery-footer';

describe('DeliveryFooter', () => {
  let component: DeliveryFooter;
  let fixture: ComponentFixture<DeliveryFooter>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeliveryFooter],
    }).compileComponents();

    fixture = TestBed.createComponent(DeliveryFooter);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
