import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { BLOOD_TESTS, type BloodTest } from './blood-work-result.entity';
import { BLOOD_TEST_UNITS } from './clinical-records.schemas';
import { type ReportSummary } from './lab-report-summary.entity';

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
- Never guess a value.

Also write "summary": a concise, professional clinical summary of the WHOLE report for doctor review (every test on it, not only the list above).
- "patient": label/value pairs printed on the report (name, age, sex, lab, sample or report date, referring doctor, report id). Leave out what is not printed.
- "abnormal": every result outside the lab's own reference range, most important first: test name as printed, exact value, unit, the lab's range, and flag "high" or "low" ("abnormal" when the lab marks it without a direction).
- "normal": normal results grouped by category (for example "Thyroid", "Vitamins & iron"), each with the test names in one short line.
- "overview": 2 to 4 sentences of clinical overview. Keep lab findings and interpretation apart; no diagnosis that the report does not support, no treatment or prescription.
- "reviewPoints": short follow-up considerations for the doctor.
- "unreadable": values or names that are unclear and need checking. Never guess an unclear value.
Use the lab's reference ranges only. Do not repeat information. Write in English.

The upload can hold several documents (numbered "Document 1", "Document 2"...). Write ONE summary for all of them together.
- Each item of "results" has "document": the number of the document it was read from. When the same test is on several documents with different dates, return each.
- "documents": one entry per document, in order: its "document" number, its "testDate" (YYYY-MM-DD or null), a short "title" (lab and kind of report) and "detail": one or two sentences on what this document holds and its main findings.
- In "abnormal" and "normal", say which document a finding comes from when there are several (for example "(Doc 2)").`;

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
          document: { type: 'INTEGER' },
        },
        required: ['test', 'value'],
      },
    },
    summary: {
      type: 'OBJECT',
      properties: {
        patient: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { label: { type: 'STRING' }, value: { type: 'STRING' } },
            required: ['label', 'value'],
          },
        },
        abnormal: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              test: { type: 'STRING' },
              value: { type: 'STRING' },
              unit: { type: 'STRING' },
              range: { type: 'STRING' },
              flag: { type: 'STRING', enum: ['high', 'low', 'abnormal'] },
            },
            required: ['test', 'value', 'flag'],
          },
        },
        normal: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { category: { type: 'STRING' }, tests: { type: 'STRING' } },
            required: ['category', 'tests'],
          },
        },
        overview: { type: 'STRING' },
        reviewPoints: { type: 'ARRAY', items: { type: 'STRING' } },
        unreadable: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['patient', 'abnormal', 'normal', 'overview', 'reviewPoints', 'unreadable'],
    },
    documents: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          document: { type: 'INTEGER' },
          testDate: { type: 'STRING', nullable: true },
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
        },
        required: ['document', 'title', 'detail'],
      },
    },
  },
  required: ['results', 'summary', 'documents'],
};

export interface ReadReport {
  testDate: string | null;
  results: { test: BloodTest; value: string; unit: string; testDate: string | null }[];
  summary: ReportSummary | null;
  model: string;
}

const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, 60) : []);

function toSummary(raw: unknown): ReportSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const summary: ReportSummary = {
    patient: list(r.patient)
      .map((p) => ({
        label: text((p as Record<string, unknown>)?.label, 60),
        value: text((p as Record<string, unknown>)?.value, 160),
      }))
      .filter((p) => p.label && p.value),
    abnormal: list(r.abnormal)
      .map((a) => {
        const row = (a ?? {}) as Record<string, unknown>;
        const flag = text(row.flag, 10).toLowerCase();
        return {
          test: text(row.test, 120),
          value: text(row.value, 40),
          unit: text(row.unit, 30),
          range: text(row.range, 60),
          flag: ['high', 'low'].includes(flag) ? flag : 'abnormal',
        };
      })
      .filter((a) => a.test && a.value),
    normal: list(r.normal)
      .map((n) => ({
        category: text((n as Record<string, unknown>)?.category, 80),
        tests: text((n as Record<string, unknown>)?.tests, 400),
      }))
      .filter((n) => n.category && n.tests),
    overview: text(r.overview, 1500),
    reviewPoints: list(r.reviewPoints)
      .map((p) => text(p, 300))
      .filter(Boolean),
    unreadable: list(r.unreadable)
      .map((p) => text(p, 200))
      .filter(Boolean),
    documents: [],
  };
  const empty =
    !summary.overview && !summary.abnormal.length && !summary.normal.length && !summary.patient.length;
  return empty ? null : summary;
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
          document: { type: 'integer' },
        },
        required: ['test', 'value', 'unit', 'document'],
      },
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        patient: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { label: { type: 'string' }, value: { type: 'string' } },
            required: ['label', 'value'],
          },
        },
        abnormal: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              test: { type: 'string' },
              value: { type: 'string' },
              unit: { type: 'string' },
              range: { type: 'string' },
              flag: { type: 'string', enum: ['high', 'low', 'abnormal'] },
            },
            required: ['test', 'value', 'unit', 'range', 'flag'],
          },
        },
        normal: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { category: { type: 'string' }, tests: { type: 'string' } },
            required: ['category', 'tests'],
          },
        },
        overview: { type: 'string' },
        reviewPoints: { type: 'array', items: { type: 'string' } },
        unreadable: { type: 'array', items: { type: 'string' } },
      },
      required: ['patient', 'abnormal', 'normal', 'overview', 'reviewPoints', 'unreadable'],
    },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document: { type: 'integer' },
          testDate: { type: ['string', 'null'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['document', 'testDate', 'title', 'detail'],
      },
    },
  },
  required: ['testDate', 'results', 'summary', 'documents'],
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
            : status === 503
              ? 'The AI service (Google) is very busy right now. Try again in a minute.'
              : status >= 500
                ? 'The AI service had a problem on its side. Try again in a minute.'
                : 'The AI service could not read this report.',
  );
}

async function post(url: string, headers: Record<string, string>, payload: unknown, timeoutMs = 110_000) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw AppError.badGateway('The AI service did not answer in time. Try again.');
  });
}

const docName = (file: Express.Multer.File, index: number) => file.originalname || `Document ${index + 1}`;

async function askOpenAi(files: Express.Multer.File[]): Promise<string> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw unavailable('Reading reports with AI is not set up. Add OPENAI_API_KEY on the server.');
  const attachments = files.flatMap((file, index) => {
    const data = file.buffer.toString('base64');
    return [
      { type: 'input_text', text: `Document ${index + 1}: ${docName(file, index)}` },
      file.mimetype === 'application/pdf'
        ? {
            type: 'input_file',
            filename: file.originalname || 'report.pdf',
            file_data: `data:application/pdf;base64,${data}`,
          }
        : { type: 'input_image', image_url: `data:${file.mimetype};base64,${data}`, detail: 'high' },
    ];
  });
  const response = await post(
    'https://api.openai.com/v1/responses',
    { Authorization: `Bearer ${key}` },
    {
      model: env.OPENAI_MODEL,
      input: [{ role: 'user', content: [...attachments, { type: 'input_text', text: PROMPT }] }],
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

async function askGemini(file: Express.Multer.File[]): Promise<string> {
  const primary = env.GEMINI_MODEL;
  const fallback = env.GEMINI_FALLBACK_MODEL;
  if (!fallback || fallback === primary) return askGeminiModel(file, primary, 110_000);
  try {
    return await askGeminiModel(file, primary, 40_000);
  } catch (err) {
    const status = err instanceof AppError ? err.status : 0;
    const retry = !(err instanceof AppError) || status === 502 || status === 503 || status === 504;
    const refused = err instanceof AppError && /refused|busy/.test(err.message);
    if (!retry || refused) throw err;
    logger.warn({ primary, fallback }, 'AI model did not answer, trying the fallback model');
    return askGeminiModel(file, fallback, 60_000);
  }
}

async function askGeminiModel(
  files: Express.Multer.File[],
  model: string,
  timeoutMs: number,
): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw unavailable('Reading reports with AI is not set up. Add GEMINI_API_KEY on the server.');
  const send = () =>
    post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': key },
      {
        contents: [
          {
            role: 'user',
            parts: [
              ...files.flatMap((file, index) => [
                { text: `Document ${index + 1}: ${docName(file, index)}` },
                { inline_data: { mime_type: file.mimetype, data: file.buffer.toString('base64') } },
              ]),
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          thinkingConfig: model.startsWith('gemini-2') ? { thinkingBudget: 0 } : { thinkingLevel: 'low' },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      },
      timeoutMs,
    );
  let response = await send();
  for (const wait of [2_000, 5_000]) {
    if (response.status !== 503 && response.status !== 500) break;
    logger.warn({ model, status: response.status }, 'AI service busy, trying again');
    await new Promise((resolve) => setTimeout(resolve, wait));
    response = await send();
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    failed('gemini', model, response.status, detail?.error?.message ?? response.statusText, 'GEMINI_API_KEY');
  }
  const body = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  return body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

export async function readBloodReport(
  input: Express.Multer.File | Express.Multer.File[],
): Promise<ReadReport> {
  const files = Array.isArray(input) ? input : [input];
  if (files.length === 0) throw AppError.badRequest('Upload at least one report');
  const provider = env.AI_PROVIDER ?? (env.OPENAI_API_KEY ? 'openai' : 'gemini');
  if (provider === 'openai' ? !env.OPENAI_API_KEY : !env.GEMINI_API_KEY) {
    throw unavailable(
      `Reading reports with AI is not set up. Add ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} on the server.`,
    );
  }
  if (files.some((file) => !READABLE_TYPES.includes(file.mimetype))) {
    throw AppError.badRequest('Upload the reports as PDFs or images (PNG, JPG, WebP)');
  }
  if (
    provider === 'openai' &&
    files.some((file) => file.mimetype === 'image/heic' || file.mimetype === 'image/heif')
  ) {
    throw AppError.badRequest(
      'HEIC photos cannot be read right now. Save the photo as JPG and upload again.',
    );
  }
  const answer = provider === 'openai' ? await askOpenAi(files) : await askGemini(files);
  let parsed: { testDate?: unknown; results?: unknown; summary?: unknown; documents?: unknown } = {};
  try {
    parsed = JSON.parse(answer) as typeof parsed;
  } catch {
    throw AppError.badGateway('The AI answer could not be read. Try a clearer report.');
  }
  const isDate = (value: unknown): value is string =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const documents = (Array.isArray(parsed.documents) ? parsed.documents : [])
    .map((d) => (d ?? {}) as { document?: unknown; testDate?: unknown; title?: unknown; detail?: unknown })
    .map((d) => {
      const index = Number(d.document) - 1;
      const file = files[index];
      return {
        index,
        name: file ? docName(file, index) : text(d.title, 120) || 'Document',
        date: isDate(d.testDate) ? d.testDate : null,
        title: text(d.title, 160),
        detail: text(d.detail, 800),
      };
    })
    .filter((d) => d.detail || d.title);
  const dates = documents
    .map((d) => d.date)
    .filter((d): d is string => Boolean(d))
    .sort();
  const testDate = isDate(parsed.testDate) ? parsed.testDate : (dates.at(-1) ?? null);
  const seen = new Set<string>();
  const results = (Array.isArray(parsed.results) ? parsed.results : [])
    .map((r) => r as { test?: unknown; value?: unknown; unit?: unknown; document?: unknown })
    .flatMap((r) => {
      const test = BLOOD_TESTS.find((t) => t === r.test);
      const raw = String(r.value ?? '');
      const number = /[<>]/.test(raw) ? NaN : Number(raw.replace(/[^\d.]/g, ''));
      const date = documents.find((d) => d.index === Number(r.document) - 1)?.date ?? testDate;
      const key = `${test}@${date}`;
      if (!test || seen.has(key) || !Number.isFinite(number) || number <= 0 || number >= 1e8) return [];
      const value = String(Math.round(number * 1000) / 1000);
      seen.add(key);
      const unit =
        typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim().slice(0, 20) : BLOOD_TEST_UNITS[test];
      return [{ test, value, unit, testDate: date }];
    });
  const summary = toSummary(parsed.summary);
  if (summary) {
    summary.documents = documents.map((d) => ({
      name: d.name,
      date: d.date,
      detail: [d.title, d.detail].filter(Boolean).join(': '),
    }));
  }
  return {
    testDate,
    results,
    summary,
    model: provider === 'openai' ? `openai:${env.OPENAI_MODEL}` : `gemini:${env.GEMINI_MODEL}`,
  };
}
