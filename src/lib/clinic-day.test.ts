import { today } from './validation';

describe('clinic day', () => {
  it('uses the Pakistan date, not the UTC date', () => {
    expect(today(new Date('2026-10-24T20:30:00Z'))).toBe('2026-10-25');
    expect(today(new Date('2026-10-24T18:59:00Z'))).toBe('2026-10-24');
    expect(today(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
  });
});
