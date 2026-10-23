import { Router } from 'express';
import { z } from 'zod';
import { AppDataSource } from '../../database/data-source';
import { AppError } from '../../lib/errors';
import { dataEnvelope, errorResponses, jsonContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { validate, validBody } from '../../middleware/validate';
import { authService } from '../auth/auth.service';
import { normalizePhone } from '../patients/phone';
import { patientAuth } from './patient-auth';
import { limiter } from '../../lib/rate-limit';

const NO_MATCH = 'This phone, email or username and password do not match a patient or doctor account.';
const STAFF_ONLY = 'This is a clinic staff account. Only doctors use the app; other staff use the dashboard.';

export const appLoginSchema = registry.register(
  'AppLogin',
  z.object({
    identifier: z
      .string()
      .trim()
      .min(3)
      .max(150)
      .openapi({ description: 'Patient phone number, or a doctor’s phone, email or username' }),
    password: z.string().min(1).max(72),
    device: z.string().trim().max(120).nullable().optional(),
  }),
);

type AppLoginInput = z.output<typeof appLoginSchema>;

const looksLikePhone = (value: string) => /^[+\d\s()-]{7,}$/.test(value) && normalizePhone(value) !== null;

async function doctorEmailByPhone(phone: string) {
  const last9 = normalizePhone(phone)?.last9;
  if (!last9) return null;
  const [row] = (await AppDataSource.query(
    `SELECT s.email FROM staff_profiles s
       JOIN doctors d ON d.staff_id = s.id AND d.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND s.status = 'active' AND s.role = 'doctor'
        AND RIGHT(regexp_replace(COALESCE(s.phone, ''), '\\D', '', 'g'), 9) = $1
      LIMIT 1`,
    [last9],
  )) as { email: string }[];
  return row?.email ?? null;
}

async function doctorSession(identifier: string, password: string) {
  const session = await authService.login(identifier, password);
  if (session.me.role !== 'doctor') throw AppError.forbidden(STAFF_ONLY);
  return { role: 'doctor' as const, accessToken: session.accessToken, refreshToken: session.refreshToken };
}

const isUnauthorized = (error: unknown) => error instanceof AppError && error.status === 401;

export async function appLogin(input: AppLoginInput) {
  if (!looksLikePhone(input.identifier)) {
    return doctorSession(input.identifier, input.password).catch((error: unknown) => {
      throw isUnauthorized(error) ? AppError.unauthorized(NO_MATCH) : error;
    });
  }
  try {
    const session = await patientAuth.loginWithPassword({
      phone: input.identifier,
      password: input.password,
      device: input.device ?? null,
    });
    return { role: 'patient' as const, accessToken: session.accessToken, refreshToken: session.refreshToken };
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }
  const email = await doctorEmailByPhone(input.identifier);
  if (email) {
    try {
      return await doctorSession(email, input.password);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
    }
  }
  throw AppError.unauthorized(NO_MATCH);
}

export const appLoginRouter = Router();

appLoginRouter.post(
  '/app/login',
  limiter('app-login', {
    windowMs: 15 * 60_000,
    limit: 20,
    message: 'Too many attempts. Try again in a few minutes.',
  }),
  validate({ body: appLoginSchema }),
  async (req, res) => {
    sendOk(res, await appLogin(validBody(req, appLoginSchema)));
  },
);

registry.registerPath({
  tags: ['Patient app'],
  method: 'post',
  path: '/app/login',
  summary:
    'One login for the mobile app. A phone number logs in the patient with that password, or a doctor with that phone. An email or username logs in a doctor. The answer says which side to open (role).',
  request: { body: { content: { 'application/json': { schema: appLoginSchema } } } },
  responses: {
    200: {
      description: 'Session',
      ...jsonContent(
        dataEnvelope(
          z.object({
            role: z.enum(['patient', 'doctor']),
            accessToken: z.string(),
            refreshToken: z.string(),
          }),
        ),
      ),
    },
    ...errorResponses,
  },
});
