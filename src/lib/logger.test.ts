import { safePath } from './logger';

describe('safe log paths', () => {
  it('drops the query string so searches with names or phones are not logged', () => {
    expect(safePath('/api/v1/branch/patients?search=03001234567&page=2')).toBe('/api/v1/branch/patients');
  });

  it('hides the token of a public patient history link', () => {
    expect(safePath('/api/v1/public/patient-history/eyJhYmMi.c2ln/sections/history')).toBe(
      '/api/v1/public/patient-history/[token]/sections/history',
    );
    expect(safePath('/api/v1/public/patient-history/eyJhYmMi.c2ln?x=1')).toBe(
      '/api/v1/public/patient-history/[token]',
    );
  });
});
