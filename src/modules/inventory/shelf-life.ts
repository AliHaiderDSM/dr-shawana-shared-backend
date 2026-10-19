import { AppError } from '../../lib/errors';
import { today } from '../../lib/validation';

export const MIN_SHELF_DAYS = 45;

export function shelfCutoff(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + MIN_SHELF_DAYS);
  return day.toISOString().slice(0, 10);
}

export const tooShortToUse = (expiryDate: string | null | undefined, date: string) =>
  Boolean(expiryDate) && (expiryDate as string) < shelfCutoff(date);

export function assertShelfLife(
  items: { productName?: string; batch?: string | null; expiryDate?: string | null }[],
  date: string,
) {
  const on = date > today() ? date : today();
  const short = items.filter((i) => tooShortToUse(i.expiryDate, on));
  if (short.length === 0) return;
  throw AppError.unprocessable(
    `${short
      .map(
        (i) =>
          `${i.productName ?? 'A product'}${i.batch ? ` (batch ${i.batch})` : ''} expires on ${i.expiryDate}`,
      )
      .join(
        '; ',
      )}. Stock with less than ${MIN_SHELF_DAYS} days to expiry cannot be taken in, sent, sold or dispatched.`,
    { expiring: short.map((i) => ({ batch: i.batch ?? null, expiryDate: i.expiryDate })) },
  );
}
