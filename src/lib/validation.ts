import { z } from 'zod';
import './openapi';

const decimal = (scale: number) =>
  z
    .union([z.number(), z.string().trim()])
    .transform((v) => String(v))
    .refine((v) => new RegExp(`^\\d{1,10}(\\.\\d{1,${scale}})?$`).test(v), {
      message: `Must be a non-negative number with at most ${scale} decimals`,
    })
    .openapi({ type: 'string', example: scale === 2 ? '1250.50' : '10.000' });

export const moneyInput = decimal(2);

export const quantityInput = decimal(3);

export const positiveQuantityInput = decimal(3).refine((v) => Number(v) > 0, 'Must be greater than zero');

export const dateInput = z.iso.date().openapi({ example: '2026-09-30' });

const EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9_%+-])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .max(150)
  .refine((v) => EMAIL_PATTERN.test(v) && !v.includes('..'), 'Enter a valid email address, e.g. name@example.com')
  .openapi({ format: 'email', example: 'name@example.com' });

export const optionalEmailInput = emailInput.nullable().optional();

export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const requiredText = (min: number, max: number) => z.string().trim().min(min).max(max);

export const optionalUuid = z.uuid().nullable().optional();

export const atLeastOneField = <T extends z.ZodObject>(schema: T) =>
  schema.partial().refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const moneyOutput = z.string().openapi({ example: '1250.50' });

export const quantityOutput = z.string().openapi({ example: '10.000' });

export const today = () => new Date().toISOString().slice(0, 10);
