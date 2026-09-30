import { Decimal, toMoney, type DecimalInput } from '../../database/transformers';
import { type PaymentStatus } from './sale.entity';

export interface PricedLine {
  qty: DecimalInput;
  unitPrice: DecimalInput;
}

export interface DiscountChoice {
  autoDiscount?: boolean;
  discountPercent?: DecimalInput;
}

export function lineTotal(line: PricedLine) {
  return toMoney(new Decimal(line.qty).times(line.unitPrice));
}

export function saleTotals(lines: PricedLine[], received: DecimalInput, discount: DiscountChoice) {
  const subtotal = toMoney(lines.reduce((sum, l) => sum.plus(lineTotal(l)), new Decimal(0)));
  const paid = toMoney(received);
  let discountPercent: Decimal;
  let discountAmount: Decimal;
  if (discount.autoDiscount) {
    discountAmount = toMoney(Decimal.max(0, subtotal.minus(paid)));
    discountPercent = subtotal.isZero()
      ? new Decimal(0)
      : discountAmount.div(subtotal).times(100).toDecimalPlaces(2);
  } else {
    discountPercent = new Decimal(discount.discountPercent ?? 0).toDecimalPlaces(2);
    discountAmount = toMoney(subtotal.times(discountPercent).div(100));
  }
  const total = toMoney(subtotal.minus(discountAmount));
  const remaining = toMoney(total.minus(paid));
  const totalQty = lines.reduce((sum, l) => sum.plus(l.qty), new Decimal(0));
  const paymentStatus: PaymentStatus =
    paid.lte(0) && total.gt(0) ? 'unpaid' : remaining.gt(0) ? 'partial' : 'paid';
  return {
    totalQty: totalQty.toFixed(3),
    subtotal,
    discountPercent: discountPercent.toFixed(2),
    discountAmount,
    total,
    received: paid,
    remaining,
    paymentStatus,
  };
}
