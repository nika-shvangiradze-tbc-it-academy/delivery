import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeliveryHeader } from './delivery-header';

describe('DeliveryHeader', () => {
  let component: DeliveryHeader;
  let fixture: ComponentFixture<DeliveryHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeliveryHeader],
    }).compileComponents();

    fixture = TestBed.createComponent(DeliveryHeader);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
