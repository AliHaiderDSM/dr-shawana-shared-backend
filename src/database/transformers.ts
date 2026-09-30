import Decimal from 'decimal.js';
import { type ValueTransformer } from 'typeorm';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal | string | number;

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;

function withFixedJson(value: Decimal, scale: number): Decimal {
  Object.defineProperty(value, 'toJSON', { value: () => value.toFixed(scale), enumerable: false });
  return value;
}

function scaledTransformer(scale: number): ValueTransformer {
  return {
    to(value: DecimalInput | null | undefined): string | null | undefined {
      if (value === null || value === undefined) return value;
      return new Decimal(value).toFixed(scale);
    },
    from(value: string | null): Decimal | null {
      if (value === null || value === undefined) return null;
      return withFixedJson(new Decimal(value), scale);
    },
  };
}

export const decimalTransformer = scaledTransformer(QUANTITY_SCALE);
export const moneyTransformer = scaledTransformer(MONEY_SCALE);
export const quantityTransformer = scaledTransformer(QUANTITY_SCALE);

const numericColumn =
  (scale: number, transformer: ValueTransformer) =>
  (options: { nullable?: boolean; default?: string } = {}) => ({
    type: 'numeric' as const,
    precision: 12,
    scale,
    transformer,
    nullable: options.nullable ?? false,
    ...(options.default !== undefined ? { default: options.default } : {}),
  });

export const moneyColumn = numericColumn(MONEY_SCALE, moneyTransformer);

export const quantityColumn = numericColumn(QUANTITY_SCALE, quantityTransformer);

export const toMoney = (value: DecimalInput): Decimal =>
  withFixedJson(new Decimal(value).toDecimalPlaces(MONEY_SCALE), MONEY_SCALE);

export const toQuantity = (value: DecimalInput): Decimal =>
  withFixedJson(new Decimal(value).toDecimalPlaces(QUANTITY_SCALE), QUANTITY_SCALE);

export { Decimal };
