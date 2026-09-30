export function assertSafeTestDatabase(): void {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  const testUrl = raw && !/<[^>]+>/.test(raw) ? raw : undefined;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is not set. Tests need a SEPARATE database (see .env.example).');
  }
  if (process.env.DATABASE_URL && testUrl.trim() === process.env.DATABASE_URL.trim()) {
    throw new Error(
      'Refusing to run tests: TEST_DATABASE_URL equals DATABASE_URL. Tests truncate all tables.',
    );
  }
}
