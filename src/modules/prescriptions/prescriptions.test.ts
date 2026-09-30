import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';
import { CATALOG_SEED } from './catalog-seed';
import { catalogService } from './prescriptions.service';

const fake = installFakeSupabase();
const app = createApp();

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  defaultDose: string | null;
  isActive: boolean;
}

describe('prescriptions', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let doctorUser: { id: string };
  let otherDoctorUser: { id: string };
  let islamabadAdmin: { id: string };
  let superAdmin: { id: string };
  let doctorId: string;
  let otherDoctorId: string;
  let patientId: string;
  let consultationId: string;
  let catalog: CatalogRow[];
  let prescriptionId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const item = (code: string) => catalog.find((c) => c.code === code) as CatalogRow;

  beforeAll(async () => {
    const lahore = await createBranch({ code: 'LHR' });
    const islamabad = await createBranch({ code: 'ISB' });
    await catalogService.seedBranch(lahore.id);
    await catalogService.seedBranch(islamabad.id);
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahore.id });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahore.id });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId: lahore.id });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabad.id });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });
    doctorId = (
      await api('post', '/branch/doctors', admin).send({
        staffId: doctorUser.id,
        displayName: 'Dr. Shawana',
        details: 'MBBS',
      })
    ).body.data.id;
    otherDoctorId = (await api('post', '/branch/doctors', admin).send({ staffId: otherDoctorUser.id })).body
      .data.id;
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Ayesha',
        phone: '923001234567',
        city: 'Lahore',
      })
    ).body.data.id;
    const appointmentId = (
      await api('post', '/branch/appointments', frontDesk).send({
        patientId,
        doctorId,
        date: '2026-09-01',
        timeFrom: '10:00',
        timeTo: '10:30',
        mode: 'physical',
        visitType: 'new',
      })
    ).body.data.id;
    consultationId = (await api('post', `/branch/appointments/${appointmentId}/consultation`, doctorUser))
      .body.data.id;
  });

  describe('catalog', () => {
    it('is seeded idempotently, and a new branch gets it on creation', async () => {
      const res = await api('get', '/branch/prescription-catalog', doctorUser);
      expect(res.status).toBe(200);
      catalog = res.body.data;
      const active = CATALOG_SEED.filter((c) => c.isActive).length;
      expect(catalog).toHaveLength(active);
      expect(catalog[0]).toMatchObject({ code: 'pres_fsh', name: 'FSH' });
      expect(item('pres_progest1')).toMatchObject({ defaultDose: 'Take one capsule every day at bed time' });

      const all = await api('get', '/branch/prescription-catalog?includeInactive=true', admin);
      expect(all.body.data).toHaveLength(CATALOG_SEED.length);
      expect(await catalogService.seedBranch((await branchOf(admin)) as string)).toBe(0);

      const branch = await api('post', '/admin/branches', superAdmin).send({
        name: 'Multan',
        code: 'MUX',
        city: 'Multan',
      });
      expect(branch.status).toBe(201);
      const multan = await api(
        'get',
        `/branch/prescription-catalog?branchId=${branch.body.data.id}`,
        superAdmin,
      );
      expect(multan.body.data).toHaveLength(active);
    });

    it('lets only the branch admin manage it', async () => {
      const created = await api('post', '/branch/prescription-catalog', admin).send({
        category: 'supplement',
        groupName: 'Supplements',
        name: 'Probiotic',
        defaultDose: 'one capsule daily',
      });
      expect(created.status).toBe(201);
      expect(created.body.data.code).toMatch(/^custom-/);
      expect((await api('post', '/branch/prescription-catalog', doctorUser).send({})).status).toBe(403);
      const off = await api('patch', `/branch/prescription-catalog/${item('pres_TXA').id}`, admin).send({
        isActive: false,
      });
      expect(off.body.data.isActive).toBe(false);
      expect((await api('get', '/branch/prescription-catalog', frontDesk)).status).toBe(403);
    });
  });

  describe('writing prescriptions', () => {
    it('copies catalog items and allows overrides and custom items', async () => {
      const res = await api('post', '/branch/prescriptions', doctorUser).send({
        consultationId,
        date: '2026-09-01',
        diagnosis: 'Perimenopause',
        notes: { blood: 'Fasting sample' },
        planTreatment: '<p>Start BHRT</p>',
        followupDate: '2026-10-01',
        items: [
          { catalogItemId: item('pres_estradiol1').id },
          { catalogItemId: item('pres_fsh').id, optional: true },
          { catalogItemId: item('pres_magnesium').id, dose: 'Elemental 120mg at bedtime' },
          { name: 'Sunscreen SPF 50', category: 'skin_care', dose: 'every morning' },
        ],
      });
      expect(res.status).toBe(201);
      prescriptionId = res.body.data.id;
      expect(res.body.data).toMatchObject({
        patientId,
        doctorId,
        consultationId,
        templateVersion: 'current',
        doctor: { name: 'Dr. Shawana' },
      });
      expect(res.body.data.prescriptionNo).toEqual(expect.any(Number));
      expect(res.body.data.items.map((i: { name: string }) => i.name)).toEqual([
        'FSH',
        'DSM Magnesium Glycinate 800mg',
        'Estradiol BHRT',
        'Sunscreen SPF 50',
      ]);
      expect(res.body.data.items[0].optional).toBe(true);
      expect(res.body.data.items[1].dose).toBe('Elemental 120mg at bedtime');
      expect(res.body.data.items[2].instructions).toContain('mid-thigh');
      expect(res.body.data.items[3]).toMatchObject({ catalogItemId: null, groupName: 'Other' });
    });

    it('rejects inactive or foreign items and bad input', async () => {
      const base = { consultationId, diagnosis: 'x' };
      expect(
        (
          await api('post', '/branch/prescriptions', doctorUser).send({
            ...base,
            items: [{ catalogItemId: item('pres_TXA').id }],
          })
        ).status,
      ).toBe(400);
      const foreign = (await api('get', '/branch/prescription-catalog', islamabadAdmin)).body.data[0].id;
      expect(
        (
          await api('post', '/branch/prescriptions', doctorUser).send({
            ...base,
            items: [{ catalogItemId: foreign }],
          })
        ).status,
      ).toBe(400);
      expect(
        (await api('post', '/branch/prescriptions', doctorUser).send({ consultationId, diagnosis: '' }))
          .status,
      ).toBe(400);
      expect((await api('post', '/branch/prescriptions', doctorUser).send({ diagnosis: 'x' })).status).toBe(
        400,
      );
      expect(
        (await api('post', '/branch/prescriptions', admin).send({ patientId, diagnosis: 'x' })).status,
      ).toBe(400);
    });

    it('keeps doctors to their own prescriptions and front desk out', async () => {
      const forOther = await api('post', '/branch/prescriptions', doctorUser).send({
        patientId,
        doctorId: otherDoctorId,
        diagnosis: 'x',
      });
      expect(forOther.status).toBe(403);
      const byAdmin = await api('post', '/branch/prescriptions', admin).send({
        patientId,
        doctorId: otherDoctorId,
        diagnosis: 'Admin written',
      });
      expect(byAdmin.status).toBe(201);
      expect((await api('get', `/branch/prescriptions/${byAdmin.body.data.id}`, doctorUser)).status).toBe(
        404,
      );
      const own = await api('get', '/branch/prescriptions', doctorUser);
      expect(own.body.data.map((p: { id: string }) => p.id)).toEqual([prescriptionId]);

      expect(
        (await api('post', '/branch/prescriptions', frontDesk).send({ patientId, doctorId, diagnosis: 'x' }))
          .status,
      ).toBe(403);
      expect((await api('get', '/branch/prescriptions', frontDesk)).status).toBe(403);
      expect((await api('get', `/branch/prescriptions/${prescriptionId}`, islamabadAdmin)).status).toBe(404);

      const search = await api(
        'get',
        `/branch/prescriptions?search=PRE%23${own.body.data[0].prescriptionNo}`,
        admin,
      );
      expect(search.body.data.map((p: { id: string }) => p.id)).toEqual([prescriptionId]);
    });

    it('replaces the items on edit and audits every change', async () => {
      const res = await api('patch', `/branch/prescriptions/${prescriptionId}`, doctorUser).send({
        diagnosis: 'Perimenopause with insomnia',
        items: [{ catalogItemId: item('pres_progest1').id }],
      });
      expect(res.status).toBe(200);
      expect(res.body.data.diagnosis).toBe('Perimenopause with insomnia');
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.notes).toEqual({ blood: 'Fasting sample' });

      const logs = await AppDataSource.getRepository(AuditLog).find({
        where: { entity: 'prescription', entityId: prescriptionId },
        order: { createdAt: 'ASC' },
      });
      expect(logs.map((l) => l.action)).toEqual(['create', 'update']);
      expect((logs[1]?.before as { items: unknown[] }).items).toHaveLength(4);
    });

    it('returns print data grouped in form order with the doctor signature', async () => {
      await api('patch', `/branch/prescriptions/${prescriptionId}`, doctorUser).send({
        items: [
          { catalogItemId: item('pres_estradiol1').id },
          { catalogItemId: item('pres_fsh').id },
          { catalogItemId: item('pres_tsh').id },
          { catalogItemId: item('pres_dexaScan').id },
        ],
      });
      const signature = await request(app)
        .post(`/api/v1/branch/doctors/${doctorId}/signature`)
        .set(bearer(admin))
        .attach('image', Buffer.from('png'), { filename: 'sign.png', contentType: 'image/png' });
      expect(signature.body.data.hasSignature).toBe(true);

      const print = await api('get', `/branch/prescriptions/${prescriptionId}/print`, doctorUser);
      expect(print.status).toBe(200);
      expect(print.body.data.doctor).toMatchObject({ name: 'Dr. Shawana', details: 'MBBS' });
      expect(print.body.data.doctor.signatureUrl).toContain('doctor-signatures/');
      expect(print.body.data.patient).toMatchObject({ name: 'Ayesha', city: 'Lahore' });
      expect(print.body.data.sections.map((s: { category: string }) => s.category)).toEqual([
        'lab',
        'imaging',
        'bhrt',
      ]);
      expect(print.body.data.sections[0]).toMatchObject({
        note: 'Fasting sample',
        groups: [{ groupName: 'Baseline', items: [{ name: 'FSH' }, { name: 'TSH' }] }],
      });
    });

    it('shows prescriptions in the patient timeline and lets only the branch admin delete', async () => {
      const timeline = await api('get', `/branch/patients/${patientId}/timeline`, doctorUser);
      expect(timeline.body.data.prescriptions.map((p: { id: string }) => p.id)).toEqual([prescriptionId]);
      expect((await api('delete', `/branch/prescriptions/${prescriptionId}`, doctorUser)).status).toBe(403);
      expect((await api('delete', `/branch/prescriptions/${prescriptionId}`, admin)).status).toBe(204);
      expect((await api('get', `/branch/prescriptions/${prescriptionId}`, admin)).status).toBe(404);
    });
  });

  async function branchOf(who: { id: string }) {
    const me = await request(app).get('/api/v1/auth/me').set(bearer(who));
    return me.body.data.branch?.id as string | undefined;
  }
});
