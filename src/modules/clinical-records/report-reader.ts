import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { BLOOD_TESTS, type BloodTest } from './blood-work-result.entity';
import { BLOOD_TEST_UNITS } from './clinical-records.schemas';

const READABLE_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
];

const TEST_NAMES: Record<BloodTest, string> = {
  fsh: 'FSH (follicle stimulating hormone)',
  estradiol: 'Estradiol (E2, oestradiol)',
  testosterone_free: 'Free testosterone',
  testosterone_total: 'Total testosterone',
  dhea_s: 'DHEA-S (DHEA sulphate)',
  vit_d3: 'Vitamin D3 (25-OH vitamin D)',
  tsh: 'TSH (thyroid stimulating hormone)',
  ferritin: 'Ferritin',
  b12: 'Vitamin B12',
};

const PROMPT = `You read laboratory reports for a menopause clinic.
Find only these tests and return their numeric result exactly as printed on the report:
${BLOOD_TESTS.map((t) => `- ${t}: ${TEST_NAMES[t]}, usual unit ${BLOOD_TEST_UNITS[t]}`).join('\n')}
Rules:
- Use the code on the left as "test".
- "value" is the number only (no "<", ">", units or ranges). Skip a test that is not on the report or has no number.
- "unit" is the unit printed next to the result.
- "testDate" is the sample collection or report date as YYYY-MM-DD, or null when the report shows none.
- Never guess a value.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    testDate: { type: 'STRING', nullable: true },
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          test: { type: 'STRING', enum: [...BLOOD_TESTS] },
          value: { type: 'STRING' },
          unit: { type: 'STRING' },
        },
        required: ['test', 'value'],
      },
    },
  },
  required: ['results'],
};

export interface ReadReport {
  testDate: string | null;
  results: { test: BloodTest; value: string; unit: string }[];
}

const OPENAI_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    testDate: { type: ['string', 'null'] },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          test: { type: 'string', enum: [...BLOOD_TESTS] },
          value: { type: 'string' },
          unit: { type: 'string' },
        },
        required: ['test', 'value', 'unit'],
      },
    },
  },
  required: ['testDate', 'results'],
};

const unavailable = (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message);

function failed(provider: string, model: string, status: number, reason: string, keyName: string): never {
  logger.warn({ provider, status, model, reason }, 'AI report request failed');
  throw AppError.badGateway(
    status === 429
      ? 'The AI service is busy or out of credit. Try again in a minute, or check the account balance.'
      : status === 401
        ? `The AI key was refused. Check ${keyName} on the server.`
        : status === 404
          ? `The AI model "${model}" is not available. Change the model setting on the server.`
          : status === 400 || status === 403
            ? `The AI service refused the request: ${reason}`
            : 'The AI service could not read this report.',
  );
}

async function post(url: string, headers: Record<string, string>, payload: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(110_000),
  }).catch(() => {
    throw AppError.badGateway('Could not reach the AI service. Try again.');
  });
}

async function askOpenAi(file: Express.Multer.File): Promise<string> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw unavailable('Reading reports with AI is not set up. Add OPENAI_API_KEY on the server.');
  const data = file.buffer.toString('base64');
  const attachment =
    file.mimetype === 'application/pdf'
      ? {
          type: 'input_file',
          filename: file.originalname || 'report.pdf',
          file_data: `data:application/pdf;base64,${data}`,
        }
      : { type: 'input_image', image_url: `data:${file.mimetype};base64,${data}`, detail: 'high' };
  const response = await post(
    'https://api.openai.com/v1/responses',
    { Authorization: `Bearer ${key}` },
    {
      model: env.OPENAI_MODEL,
      input: [{ role: 'user', content: [attachment, { type: 'input_text', text: PROMPT }] }],
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'blood_report', strict: true, schema: OPENAI_SCHEMA } },
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    failed(
      'openai',
      env.OPENAI_MODEL,
      response.status,
      detail?.error?.message ?? response.statusText,
      'OPENAI_API_KEY',
    );
  }
  const body = (await response.json().catch(() => null)) as {
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  } | null;
  return (body?.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('');
}

async function askGemini(file: Express.Multer.File): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw unavailable('Reading reports with AI is not set up. Add GEMINI_API_KEY on the server.');
  const response = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    { 'x-goog-api-key': key },
    {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        thinkingConfig: env.GEMINI_MODEL.startsWith('gemini-2')
          ? { thinkingBudget: 0 }
          : { thinkingLevel: 'low' },
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    failed(
      'gemini',
      env.GEMINI_MODEL,
      response.status,
      detail?.error?.message ?? response.statusText,
      'GEMINI_API_KEY',
    );
  }
  const body = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  return body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

export async function readBloodReport(file: Express.Multer.File): Promise<ReadReport> {
  const provider = env.AI_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'gemini');
  if (provider === 'openai' ? !env.OPENAI_API_KEY : !env.GEMINI_API_KEY) {
    throw unavailable(
      `Reading reports with AI is not set up. Add ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} on the server.`,
    );
  }
  if (!READABLE_TYPES.includes(file.mimetype)) {
    throw AppError.badRequest('Upload the report as a PDF or an image (PNG, JPG, WebP)');
  }
  const text = provider === 'openai' ? await askOpenAi(file) : await askGemini(file);
  let parsed: { testDate?: unknown; results?: unknown } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw AppError.badGateway('The AI answer could not be read. Try a clearer report.');
  }
  const seen = new Set<string>();
  const results = (Array.isArray(parsed.results) ? parsed.results : [])
    .map((r) => r as { test?: unknown; value?: unknown; unit?: unknown })
    .flatMap((r) => {
      const test = BLOOD_TESTS.find((t) => t === r.test);
      const raw = String(r.value ?? '');
      const number = /[<>]/.test(raw) ? NaN : Number(raw.replace(/[^\d.]/g, ''));
      if (!test || seen.has(test) || !Number.isFinite(number) || number <= 0 || number >= 1e8) return [];
      const value = String(Math.round(number * 1000) / 1000);
      seen.add(test);
      const unit =
        typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim().slice(0, 20) : BLOOD_TEST_UNITS[test];
      return [{ test, value, unit }];
    });
  const testDate =
    typeof parsed.testDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.testDate)
      ? parsed.testDate
      : null;
  return { testDate, results };
}
