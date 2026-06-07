import { TestBed } from '@angular/core/testing';

import { Measurement } from './measurement';

describe('Measurement', () => {
  let service: Measurement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Measurement);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
