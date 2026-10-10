import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

function cleanEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    const value = raw?.trim();
    if (value && !/<[^>]+>/.test(value)) out[key] = value;
  }
  return out;
}

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// connection string');

const supabaseVar = isProd ? z.string().min(1) : z.string().optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: isTest ? postgresUrl.optional() : postgresUrl,
    TEST_DATABASE_URL: isTest ? postgresUrl : postgresUrl.optional(),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    DATABASE_SSL_CA: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    SUPABASE_URL: isProd ? z.url() : z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: supabaseVar,
    SUPABASE_ANON_KEY: supabaseVar,
    PATIENT_LINK_SECRET: z.string().min(32).optional(),

    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    AI_PROVIDER: z.enum(['openai', 'gemini']).optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-5.4-mini'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.8-flash'),

    SUPER_ADMIN_EMAIL: z.union([z.email(), z.literal('')]).optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test' && env.DATABASE_URL && env.TEST_DATABASE_URL === env.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['TEST_DATABASE_URL'],
        message: 'TEST_DATABASE_URL must NOT equal DATABASE_URL (tests truncate tables)',
      });
    }
  });

const parsed = envSchema.safeParse(cleanEnv(process.env));

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const databaseUrl: string = (env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL) ?? '';

export const isProduction = env.NODE_ENV === 'production';
