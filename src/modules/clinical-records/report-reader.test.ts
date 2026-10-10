import { env } from '../../config/env';
import { readBloodReport } from './report-reader';

const file = (mimetype: string) =>
  ({ mimetype, buffer: Buffer.from('%PDF-1.4'), originalname: 'report.pdf' }) as Express.Multer.File;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const geminiAnswer = (payload: unknown) =>
  json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });

const openAiAnswer = (payload: unknown) =>
  json({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] },
    ],
  });

describe('reading a blood report with AI', () => {
  const saved = {
    provider: env.AI_PROVIDER,
    gemini: env.GEMINI_API_KEY,
    openai: env.OPENAI_API_KEY,
  };
  afterEach(() => {
    env.AI_PROVIDER = saved.provider;
    env.GEMINI_API_KEY = saved.gemini;
    env.OPENAI_API_KEY = saved.openai;
    jest.restoreAllMocks();
  });

  it('refuses when the chosen provider has no key', async () => {
    env.AI_PROVIDER = 'gemini';
    env.GEMINI_API_KEY = undefined;
    await expect(readBloodReport(file('application/pdf'))).rejects.toMatchObject({ status: 503 });
    env.AI_PROVIDER = 'openai';
    env.OPENAI_API_KEY = undefined;
    await expect(readBloodReport(file('application/pdf'))).rejects.toMatchObject({ status: 503 });
  });

  it('keeps only known tests with clean numbers (Gemini)', async () => {
    env.AI_PROVIDER = 'gemini';
    env.GEMINI_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      geminiAnswer({
        testDate: '2026-09-20',
        results: [
          { test: 'fsh', value: '45.5 mIU/mL', unit: 'mIU/mL' },
          { test: 'estradiol', value: '<5', unit: 'pg/mL' },
          { test: 'fsh', value: '99', unit: 'mIU/mL' },
          { test: 'cholesterol', value: '180', unit: 'mg/dL' },
          { test: 'tsh', value: 'not done', unit: '' },
        ],
      }),
    );
    expect(await readBloodReport(file('application/pdf'))).toEqual({
      testDate: '2026-09-20',
      results: [{ test: 'fsh', value: '45.5', unit: 'mIU/mL' }],
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });

  it('sends PDFs and images to OpenAI and reads its answer', async () => {
    env.AI_PROVIDER = 'openai';
    env.OPENAI_API_KEY = 'sk-test';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          openAiAnswer({ testDate: null, results: [{ test: 'tsh', value: '2.45', unit: 'uIU/mL' }] }),
        ),
      );
    expect(await readBloodReport(file('application/pdf'))).toEqual({
      testDate: null,
      results: [{ test: 'tsh', value: '2.45', unit: 'uIU/mL' }],
    });
    await readBloodReport(file('image/jpeg'));
    const [url, pdfInit] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((pdfInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    const pdfBody = JSON.parse(String((pdfInit as RequestInit).body)) as {
      input: { content: { type: string }[] }[];
      text: { format: { type: string; strict: boolean } };
    };
    expect(pdfBody.input[0]!.content[0]!.type).toBe('input_file');
    expect(pdfBody.text.format).toMatchObject({ type: 'json_schema', strict: true });
    const imageBody = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body)) as {
      input: { content: { type: string }[] }[];
    };
    expect(imageBody.input[0]!.content[0]!.type).toBe('input_image');
  });

  it('rejects other file types and explains provider errors', async () => {
    env.AI_PROVIDER = 'openai';
    env.OPENAI_API_KEY = 'sk-test';
    await expect(readBloodReport(file('text/plain'))).rejects.toMatchObject({ status: 400 });
    jest.spyOn(global, 'fetch').mockResolvedValue(json({ error: { message: 'Incorrect API key' } }, 401));
    await expect(readBloodReport(file('image/png'))).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('OPENAI_API_KEY'),
    });
  });
});
