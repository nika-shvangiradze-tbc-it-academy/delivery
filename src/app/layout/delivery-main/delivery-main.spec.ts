import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeliveryMain } from './delivery-main';

describe('DeliveryMain', () => {
  let component: DeliveryMain;
  let fixture: ComponentFixture<DeliveryMain>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeliveryMain],
    }).compileComponents();

    fixture = TestBed.createComponent(DeliveryMain);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
