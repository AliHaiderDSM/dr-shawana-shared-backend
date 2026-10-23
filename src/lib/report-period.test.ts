import { periodProblem } from './report';

describe('periodProblem', () => {
  const today = '2026-10-23';

  it('allows a month, no period, or up to a year', () => {
    expect(periodProblem({}, today)).toBeNull();
    expect(periodProblem({ month: '2026-01' }, today)).toBeNull();
    expect(periodProblem({ from: '2025-10-23', to: '2026-10-23' }, today)).toBeNull();
    expect(periodProblem({ from: '2026-01-01' }, today)).toBeNull();
  });

  it('refuses periods longer than a year or without a start', () => {
    expect(periodProblem({ from: '2024-01-01', to: '2026-01-01' }, today)).toBe(
      'Choose a period of up to 366 days',
    );
    expect(periodProblem({ from: '2020-01-01' }, today)).toBe('Choose a period of up to 366 days');
    expect(periodProblem({ to: '2026-10-01' }, today)).toBe('Choose a start date as well');
    expect(periodProblem({ from: '2026-10-10', to: '2026-10-01' }, today)).toBe(
      'The end date is before the start date',
    );
  });
});
