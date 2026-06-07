import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FitAssistant } from './fit-assistant';

describe('FitAssistant', () => {
  let component: FitAssistant;
  let fixture: ComponentFixture<FitAssistant>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FitAssistant],
    }).compileComponents();

    fixture = TestBed.createComponent(FitAssistant);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
