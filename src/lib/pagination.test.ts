import { escapeLike, listQuerySchema, pageMeta } from './pagination';

describe('listQuerySchema', () => {
  const schema = listQuerySchema(['createdAt', 'name']);

  it('applies defaults', () => {
    expect(schema.parse({})).toEqual({ page: 1, pageSize: 20, sort: '-createdAt' });
  });

  it('coerces query strings and accepts allowed sorts', () => {
    expect(schema.parse({ page: '3', pageSize: '50', sort: 'name', search: '  ali ' })).toEqual({
      page: 3,
      pageSize: 50,
      sort: 'name',
      search: 'ali',
    });
  });

  it('rejects unknown sort fields and oversized pages', () => {
    expect(schema.safeParse({ sort: 'password' }).success).toBe(false);
    expect(schema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('computes page meta', () => {
    expect(pageMeta({ page: 2, pageSize: 20 }, 41)).toEqual({
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(pageMeta({ page: 1, pageSize: 20 }, 0).totalPages).toBe(1);
  });
});
