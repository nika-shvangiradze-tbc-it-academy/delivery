import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Priorites } from './priorites';

describe('Priorites', () => {
  let component: Priorites;
  let fixture: ComponentFixture<Priorites>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Priorites],
    }).compileComponents();

    fixture = TestBed.createComponent(Priorites);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
