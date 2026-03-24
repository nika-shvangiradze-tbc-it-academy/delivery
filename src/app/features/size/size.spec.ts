import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Size } from './size';

describe('Size', () => {
  let component: Size;
  let fixture: ComponentFixture<Size>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Size],
    }).compileComponents();

    fixture = TestBed.createComponent(Size);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
