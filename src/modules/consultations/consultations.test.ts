import request from 'supertest';
import { bearer, createBranch, createStaff } from '../../../tests/helpers/fixtures';
import { installFakeSupabase } from '../../../tests/helpers/supabase-fake';
import { createApp } from '../../app';
import { AppDataSource } from '../../database/data-source';
import { AuditLog } from '../audit/audit-log.entity';

const fake = installFakeSupabase();
const app = createApp();

describe('consultations and clinical records', () => {
  let admin: { id: string };
  let frontDesk: { id: string };
  let pharmacy: { id: string };
  let doctorUser: { id: string };
  let otherDoctorUser: { id: string };
  let islamabadAdmin: { id: string };
  let superAdmin: { id: string };
  let lahoreId: string;
  let islamabadId: string;
  let patientId: string;
  let newAppointmentId: string;
  let followupAppointmentId: string;
  let otherDoctorAppointmentId: string;
  let consultationId: string;
  let followupConsultationId: string;

  const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, who: { id: string }) =>
    request(app)[method](`/api/v1${path}`).set(bearer(who));
  const section = (key: string, body: object, who = doctorUser, id = consultationId) =>
    api('put', `/branch/consultations/${id}/sections/${key}`, who).send(body);

  const basicInfo = {
    name: 'Ayesha Khan',
    age: 48,
    city: 'Lahore',
    country: 'Pakistan',
    weightKg: 70,
    heightFeet: 5.4,
    maritalStatus: 'married',
    marriedYears: '20',
    hasKids: 'yes',
    kidsDetails: '2',
  };

  beforeAll(async () => {
    lahoreId = (await createBranch({ code: 'LHR' })).id;
    islamabadId = (await createBranch({ code: 'ISB' })).id;
    admin = await createStaff(fake, { role: 'branch_admin', branchId: lahoreId });
    frontDesk = await createStaff(fake, { role: 'front_desk', branchId: lahoreId });
    pharmacy = await createStaff(fake, { role: 'pharmacy', branchId: lahoreId });
    doctorUser = await createStaff(fake, { role: 'doctor', branchId: lahoreId });
    otherDoctorUser = await createStaff(fake, { role: 'doctor', branchId: lahoreId });
    islamabadAdmin = await createStaff(fake, { role: 'branch_admin', branchId: islamabadId });
    superAdmin = await createStaff(fake, { role: 'super_admin', branchId: null });

    const doctorId = (await api('post', '/branch/doctors', admin).send({ staffId: doctorUser.id })).body.data
      .id;
    const otherDoctorId = (await api('post', '/branch/doctors', admin).send({ staffId: otherDoctorUser.id }))
      .body.data.id;
    patientId = (
      await api('post', '/branch/patients', frontDesk).send({
        name: 'Ayesha',
        phone: '923001234567',
        city: 'Lahore',
      })
    ).body.data.id;
    const book = (body: object) =>
      api('post', '/branch/appointments', frontDesk).send({
        patientId,
        doctorId,
        mode: 'physical',
        visitType: 'new',
        ...body,
      });
    newAppointmentId = (await book({ date: '2026-09-01', timeFrom: '10:00', timeTo: '10:30' })).body.data.id;
    followupAppointmentId = (
      await book({ date: '2026-10-01', timeFrom: '10:00', timeTo: '10:30', visitType: 'followup' })
    ).body.data.id;
    otherDoctorAppointmentId = (
      await book({ date: '2026-10-02', timeFrom: '10:00', timeTo: '10:30', doctorId: otherDoctorId })
    ).body.data.id;
  });

  describe('consultations', () => {
    it('opens one consultation per appointment', async () => {
      const first = await api('post', `/branch/appointments/${newAppointmentId}/consultation`, frontDesk);
      expect(first.status).toBe(201);
      consultationId = first.body.data.id;
      expect(first.body.data).toMatchObject({ status: 'open', patientId, appointment: { visitType: 'new' } });
      expect(first.body.data.availableSections).not.toContain('follow_up');
      expect(first.body.data.availableSections).not.toContain('referral');
      expect(first.body.data.sections.basic_info).toBeNull();

      const again = await api('post', `/branch/appointments/${newAppointmentId}/consultation`, doctorUser);
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(consultationId);
      const byAppointment = await api('get', `/branch/appointments/${newAppointmentId}/consultation`, admin);
      expect(byAppointment.body.data.id).toBe(consultationId);
    });

    it('validates basic info and updates the patient, as posSoft does', async () => {
      const missing = await section('basic_info', {
        ...basicInfo,
        maritalStatus: undefined,
        marriedYears: '',
      });
      expect(missing.status).toBe(400);
      const noYears = await section('basic_info', { ...basicInfo, marriedYears: '' });
      expect(noYears.status).toBe(400);
      expect(noYears.body.error.details[0].path).toBe('body.marriedYears');

      const res = await section('basic_info', basicInfo, frontDesk);
      expect(res.status).toBe(200);
      expect(res.body.data.section.data).toMatchObject({
        name: 'Ayesha Khan',
        age: 48,
        bmi: 25.84,
        bmiCategory: 'overweight',
      });
      const patient = await api('get', `/branch/patients/${patientId}`, frontDesk);
      expect(patient.body.data).toMatchObject({ name: 'Ayesha Khan', age: 48, country: 'Pakistan' });

      const single = await section('basic_info', { ...basicInfo, maritalStatus: 'single' });
      expect(single.body.data.section.data).toMatchObject({
        marriedYears: null,
        hasKids: null,
        kidsDetails: null,
      });

      const audit = await AppDataSource.getRepository(AuditLog).findOneBy({
        entity: 'consultation',
        entityId: consultationId,
        action: 'save_section:basic_info',
      });
      expect(audit).not.toBeNull();
    });

    it('applies the medical history rules and shares the topics with the follow up form', async () => {
      const noDate = await section('medical_history', { havingPeriods: 'yes' });
      expect(noDate.status).toBe(400);
      const res = await section('medical_history', {
        majorComplaint: 'Hot flushes',
        havingPeriods: 'no',
        lastPeriodDate: '2026-01-01',
        dub: true,
        conditions: ['hypertension', 'hypertension', 'pcos'],
        surgeries: [{ type: 'c_section', date: '2015-05-01' }],
        hasAllergies: 'no',
        allergies: 'Penicillin',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.section.data).toMatchObject({
        majorComplaint: 'Hot flushes',
        lastPeriodDate: null,
        dub: false,
        conditions: ['hypertension', 'pcos'],
        allergies: null,
        hormoneTherapy: null,
      });

      const followup = await api(
        'post',
        `/branch/appointments/${followupAppointmentId}/consultation`,
        doctorUser,
      );
      followupConsultationId = followup.body.data.id;
      expect(followup.body.data.availableSections).toContain('follow_up');
      const saved = await section(
        'follow_up',
        {
          pgic: 'much_improved',
          majorComplaint: 'Less flushing',
          hormoneTherapySinceLastVisit: 'interrupted',
        },
        doctorUser,
        followupConsultationId,
      );
      expect(saved.status).toBe(400);
      const ok = await section(
        'follow_up',
        { pgic: 'much_improved', majorComplaint: 'Less flushing' },
        doctorUser,
        followupConsultationId,
      );
      expect(ok.status).toBe(200);
      const detail = await api('get', `/branch/consultations/${followupConsultationId}`, doctorUser);
      expect(detail.body.data.sections.follow_up.data.majorComplaint).toBe('Less flushing');

      const wrongVisit = await section('follow_up', { pgic: 'no_change' });
      expect(wrongVisit.status).toBe(422);
    });

    it('computes MRS scores on the server', async () => {
      const res = await section('mrs_scale', {
        date: '2026-09-01',
        hotFlushes: 4,
        heartDiscomfort: 2,
        sleepProblems: 3,
        depressiveMood: 1,
        sexualProblems: 2,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.section.scores).toEqual({
        somatic: 9,
        psychological: 1,
        urogenital: 2,
        total: 12,
        percentage: 27.27,
        severity: 'moderate',
      });
      expect(res.body.data.section.data.irritability).toBeNull();
      expect((await section('mrs_scale', { date: '2026-09-01', hotFlushes: 5 })).status).toBe(400);
      await section('mrs_scale', { date: '2026-10-01', hotFlushes: 1 }, doctorUser, followupConsultationId);

      const history = await api('get', `/branch/patients/${patientId}/mrs-history`, doctorUser);
      expect(history.body.data.map((h: { scores: { total: number } }) => h.scores.total)).toEqual([12, 1]);
    });

    it('opens the referral only after "Referred to specialist"', async () => {
      const referral = {
        referredTo: 'Dr. Kamal',
        specialty: 'Cardiology',
        dateOfBirth: '1978-02-10',
        date: '2026-09-01',
        referringDoctorName: 'Dr. Shawana',
        referringDoctorPhone: '923001112222',
        referringDoctorAddress: 'Gulberg, Lahore',
        reason: 'Palpitations',
      };
      expect((await section('referral', referral)).status).toBe(422);
      const assessment = await section('clinical_assessment', {
        menopauseStage: ['perimenopause'],
        treatmentPlan: ['start_bhrt', 'referred_to_specialist'],
        plan: 'Start estradiol',
      });
      expect(assessment.body.data.section.data.plan).toBe('Start estradiol');
      expect(assessment.body.data.availableSections).toContain('referral');
      expect((await section('referral', { ...referral, reason: '' })).status).toBe(400);
      expect((await section('referral', referral)).status).toBe(200);

      const patient = await api('get', `/branch/patients/${patientId}`, frontDesk);
      expect(patient.body.data.dateOfBirth).toBe('1978-02-10');
      const letter = await api('get', `/branch/consultations/${consultationId}/referral-letter`, frontDesk);
      expect(letter.body.data).toMatchObject({
        referral: { referredTo: 'Dr. Kamal', specialty: 'Cardiology' },
        patient: { name: 'Ayesha Khan', dateOfBirth: '1978-02-10' },
      });
    });

    it('limits doctors to their own consultations and keeps other branches and roles out', async () => {
      const other = await api('post', `/branch/appointments/${otherDoctorAppointmentId}/consultation`, admin);
      expect(other.status).toBe(201);
      expect((await api('get', `/branch/consultations/${other.body.data.id}`, doctorUser)).status).toBe(404);
      expect(
        (await api('post', `/branch/appointments/${otherDoctorAppointmentId}/consultation`, doctorUser))
          .status,
      ).toBe(404);
      const list = await api('get', '/branch/consultations', doctorUser);
      expect(list.body.data.map((c: { id: string }) => c.id).sort()).toEqual(
        [consultationId, followupConsultationId].sort(),
      );
      expect((await api('get', `/branch/consultations/${consultationId}`, islamabadAdmin)).status).toBe(404);
      expect((await api('get', '/branch/consultations', pharmacy)).status).toBe(403);
      expect((await api('delete', `/branch/consultations/${consultationId}`, frontDesk)).status).toBe(403);
    });

    it('marks a consultation completed', async () => {
      const res = await api('post', `/branch/consultations/${consultationId}/status`, doctorUser).send({
        status: 'completed',
      });
      expect(res.body.data.status).toBe('completed');
    });
  });

  describe('blood work, BHRT and medical records', () => {
    it('stores one row per blood test and returns chart series', async () => {
      const add = await api('post', `/branch/patients/${patientId}/blood-work`, frontDesk).send({
        consultationId,
        results: [
          { test: 'fsh', value: '45.5', testDate: '2026-08-20' },
          { test: 'estradiol', value: '20', testDate: '2026-08-20', unit: 'pmol/L' },
          { test: 'fsh', value: '30', testDate: '2026-09-25' },
        ],
      });
      expect(add.status).toBe(201);
      expect(add.body.data[0]).toMatchObject({ test: 'fsh', value: '45.500', unit: 'mIU/mL' });
      expect(add.body.data[1].unit).toBe('pmol/L');

      const list = await api('get', `/branch/patients/${patientId}/blood-work`, doctorUser);
      expect(list.body.data.dates).toEqual(['2026-08-20', '2026-09-25']);
      expect(list.body.data.tests[0]).toMatchObject({
        test: 'fsh',
        points: [{ value: '45.500' }, { value: '30.000' }],
      });

      const again = await api('post', `/branch/patients/${patientId}/blood-work`, frontDesk).send({
        results: [{ test: 'fsh', value: '50', testDate: '2026-08-20' }],
      });
      expect(again.body.data[0].id).toBe(add.body.data[0].id);
      const replaced = await api('get', `/branch/patients/${patientId}/blood-work`, doctorUser);
      expect(replaced.body.data.tests[0].points).toEqual([
        expect.objectContaining({ date: '2026-08-20', value: '50.000' }),
        expect.objectContaining({ date: '2026-09-25', value: '30.000' }),
      ]);

      const id = add.body.data[2].id;
      const fixed = await api('patch', `/branch/patients/${patientId}/blood-work/${id}`, frontDesk).send({
        value: '31',
      });
      expect(fixed.body.data.value).toBe('31.000');
      expect(
        (
          await api('patch', `/branch/patients/${patientId}/blood-work/${id}`, islamabadAdmin).send({
            value: '1',
          })
        ).status,
      ).toBe(404);
      expect((await api('delete', `/branch/patients/${patientId}/blood-work/${id}`, frontDesk)).status).toBe(
        204,
      );
      const other = await api('get', `/branch/patients/${patientId}/blood-work`, islamabadAdmin);
      expect(other.body.data.results).toEqual([]);
    });

    it("logs BHRT and keeps the patient's status on the newest entry", async () => {
      const on = await api('post', `/branch/patients/${patientId}/bhrt`, doctorUser).send({
        status: 'on',
        date: '2026-09-01',
        note: '<p>Started</p>',
        appointmentId: newAppointmentId,
      });
      expect(on.status).toBe(201);
      expect((await api('get', `/branch/patients/${patientId}`, frontDesk)).body.data.bhrtStatus).toBe('on');
      const filtered = await api('get', '/branch/appointments?bhrtStatus=on', frontDesk);
      expect(filtered.body.meta.total).toBe(3);

      await api('post', `/branch/patients/${patientId}/bhrt`, doctorUser).send({
        status: 'other',
        date: '2026-09-20',
      });
      expect((await api('get', `/branch/patients/${patientId}`, frontDesk)).body.data.bhrtStatus).toBe(
        'none',
      );
      await api('post', `/branch/patients/${patientId}/bhrt`, doctorUser).send({
        status: 'off',
        date: '2026-01-01',
      });
      expect((await api('get', `/branch/patients/${patientId}`, frontDesk)).body.data.bhrtStatus).toBe(
        'none',
      );

      const log = await api('get', `/branch/patients/${patientId}/bhrt`, frontDesk);
      expect(log.body.data.map((e: { status: string }) => e.status)).toEqual(['other', 'on', 'off']);
    });

    it('manages medical records and imaging files', async () => {
      const created = await request(app)
        .post(`/api/v1/branch/patients/${patientId}/medical-records`)
        .set(bearer(frontDesk))
        .field('data', JSON.stringify({ type: 'imaging', date: '2026-09-02', note: 'Ultrasound' }))
        .attach('files', Buffer.from('%PDF-1.4'), { filename: 'scan.pdf', contentType: 'application/pdf' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ type: 'imaging', note: 'Ultrasound' });
      const recordId = created.body.data.id;

      const added = await request(app)
        .post(`/api/v1/branch/patients/${patientId}/medical-records/${recordId}/files`)
        .set(bearer(frontDesk))
        .attach('files', Buffer.from('png'), { filename: 'b.png', contentType: 'image/png' });
      expect(added.body.data.files).toHaveLength(2);
      const fileId = added.body.data.files[0].id;
      expect(
        (await api('get', `/branch/patients/${patientId}/medical-records/files/${fileId}/url`, frontDesk))
          .status,
      ).toBe(200);
      expect(
        (
          await api(
            'delete',
            `/branch/patients/${patientId}/medical-records/${recordId}/files/${fileId}`,
            frontDesk,
          )
        ).status,
      ).toBe(204);

      const imaging = await api(
        'get',
        `/branch/patients/${patientId}/medical-records?type=imaging`,
        frontDesk,
      );
      expect(imaging.body.data).toHaveLength(1);
      expect(imaging.body.data[0].files).toHaveLength(1);
      const updated = await api(
        'patch',
        `/branch/patients/${patientId}/medical-records/${recordId}`,
        frontDesk,
      ).send({
        type: 'medical_record',
      });
      expect(updated.body.data.type).toBe('medical_record');
      expect(
        (await api('delete', `/branch/patients/${patientId}/medical-records/${recordId}`, frontDesk)).status,
      ).toBe(204);
      expect(
        (await api('get', `/branch/patients/${patientId}/medical-records`, islamabadAdmin)).body.data,
      ).toEqual([]);
    });

    it('builds the patient timeline for a branch, and for every branch for super admin', async () => {
      const timeline = await api('get', `/branch/patients/${patientId}/timeline`, frontDesk);
      expect(timeline.status).toBe(200);
      expect(timeline.body.data.scope).toBe('branch');
      expect(timeline.body.data.consultations.length).toBe(3);
      expect(timeline.body.data.prescriptions).toEqual([]);
      expect(timeline.body.data.bhrt).toHaveLength(3);
      expect(timeline.body.data.consultations[0].sections).toBeDefined();

      const doctorView = await api('get', `/branch/patients/${patientId}/timeline`, doctorUser);
      expect(doctorView.body.data.consultations).toHaveLength(2);

      await api('post', `/branch/patients/${patientId}/bhrt?branchId=${islamabadId}`, superAdmin).send({
        status: 'recommended',
      });
      const isb = await api('get', `/branch/patients/${patientId}/timeline`, islamabadAdmin);
      expect(isb.body.data.consultations).toEqual([]);
      expect(isb.body.data.bhrt).toHaveLength(1);
      const all = await api('get', `/branch/patients/${patientId}/timeline`, superAdmin);
      expect(all.body.data.scope).toBe('all_branches');
      expect(all.body.data.bhrt).toHaveLength(4);
    });
  });
});
