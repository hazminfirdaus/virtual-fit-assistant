import { TestBed } from '@angular/core/testing';

import { Pose } from './pose';

describe('Pose', () => {
  let service: Pose;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Pose);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
