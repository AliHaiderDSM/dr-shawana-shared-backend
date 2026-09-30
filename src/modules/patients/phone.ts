export interface NormalizedPhone {
  normalized: string;
  last9: string;
}

export const digitsOf = (value: string) => value.replace(/\D+/g, '');

export function normalizePhone(raw: string): NormalizedPhone | null {
  let digits = digitsOf(raw);
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith('3')) digits = `92${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return { normalized: `+${digits}`, last9: digits.slice(-9) };
}

export function last9Of(raw: string): string | null {
  const digits = digitsOf(raw);
  return digits.length >= 9 ? digits.slice(-9) : null;
}
