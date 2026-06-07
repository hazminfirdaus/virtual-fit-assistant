import { TestBed } from '@angular/core/testing';

import { SizeRecommendation } from './size-recommendation';

describe('SizeRecommendation', () => {
  let service: SizeRecommendation;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SizeRecommendation);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
