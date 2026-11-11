import request from 'supertest';
import { bearer, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';

const fake = installFakeSupabase();
const app = createApp();

describe('public privacy and account deletion pages', () => {
  it('serves both pages without login, with the clinic contact details escaped', async () => {
    const owner = await createStaff(fake, { role: 'super_admin', branchId: null });
    await request(app)
      .put('/api/v1/admin/company-info')
      .set(bearer(owner))
      .send({
        name: 'DSM <Clinic>',
        phone: '042-1234567',
        email: 'care@dsm.test',
        address: 'Gulberg, Lahore',
      })
      .expect(200);

    const privacy = await request(app).get('/privacy');
    expect(privacy.status).toBe(200);
    expect(privacy.headers['content-type']).toContain('text/html');
    expect(privacy.text).toContain('Privacy policy');
    expect(privacy.text).toContain('DSM &lt;Clinic&gt;');
    expect(privacy.text).not.toContain('DSM <Clinic>');
    expect(privacy.text).toContain('care@dsm.test');
    expect(privacy.text).toContain('Google Gemini or OpenAI');

    const deletion = await request(app).get('/account-deletion');
    expect(deletion.status).toBe(200);
    expect(deletion.text).toContain('Delete my account');
    expect(deletion.text).toContain('042-1234567');
    expect((await request(app).get('/delete-account')).status).toBe(200);
    expect((await request(app).get('/privacy-policy')).status).toBe(200);
  });
});
