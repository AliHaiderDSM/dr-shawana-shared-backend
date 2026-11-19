import 'reflect-metadata';
import { AppDataSource } from '../src/database/data-source';
import type { Actor } from '../src/lib/actor';
import { today } from '../src/lib/validation';
import {
  createAppointmentSchema,
  appointmentStatusSchema,
} from '../src/modules/appointments/appointments.schemas';
import { appointmentsService } from '../src/modules/appointments/appointments.service';
import { consultationsService } from '../src/modules/consultations/consultations.service';
import { doctorAppService } from '../src/modules/doctor-app/doctor-app.service';
import { createPrescriptionSchema } from '../src/modules/prescriptions/prescriptions.schemas';
import { prescriptionsService } from '../src/modules/prescriptions/prescriptions.service';

const VISITS = [
  {
    daysAgo: 60,
    issues: 'Hot flashes, poor sleep and low energy',
    remarks:
      '<p><strong>Perimenopause</strong> symptoms. Sleep 5 hours. Started on vitamin D and magnesium.</p>',
    diagnosis: 'Perimenopause with low vitamin D',
    plan: '<p>Start <strong>Vit D3 + K2</strong> and magnesium at bedtime.</p><ul><li>Repeat blood work in 6 weeks</li><li>Walk 30 minutes daily</li></ul>',
  },
  {
    daysAgo: 30,
    issues: 'Follow-up after blood work, hot flashes better',
    remarks: '<p>Hot flashes <em>reduced</em>. Ferritin still low. Discussed BHRT.</p>',
    diagnosis: 'Follow-up: perimenopause, low ferritin',
    plan: '<p>Continue supplements. Start <strong>progesterone</strong> 14 days a month.</p><ol><li>Iron with vitamin C</li><li>Follow-up in 1 month</li></ol>',
  },
];

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const minus = (days: number) => {
  const date = new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

async function one<T>(sql: string, params: unknown[]): Promise<T | undefined> {
  const [row] = (await AppDataSource.query(sql, params)) as T[];
  return row;
}

async function main() {
  const phone = argument('phone')?.replace(/\D/g, '').slice(-10);
  if (!phone) throw new Error('Pass the demo patient phone: --phone 03xxxxxxxxx');
  await AppDataSource.initialize();
  try {
    const patient = await one<{ id: string; name: string }>(
      `SELECT id, name FROM patients WHERE deleted_at IS NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1`,
      [phone],
    );
    if (!patient) throw new Error('No patient with that phone');
    const doctor = await one<{ id: string; staffId: string; branchId: string; name: string }>(
      `SELECT d.id, d.staff_id AS "staffId", d.branch_id AS "branchId", d.display_name AS name
         FROM appointments a JOIN doctors d ON d.id = a.doctor_id
        WHERE a.patient_id = $1 AND a.deleted_at IS NULL AND d.deleted_at IS NULL
        ORDER BY a.date DESC LIMIT 1`,
      [patient.id],
    );
    if (!doctor) throw new Error('The patient has no appointment with a doctor yet');

    const actor: Actor = {
      userId: doctor.staffId,
      role: 'doctor',
      branchId: doctor.branchId,
      isSuperAdmin: false,
      ip: null,
    };
    const viewer = { branchId: doctor.branchId, doctorId: doctor.id };
    const catalog = (await AppDataSource.query(
      `SELECT id, category::text AS category FROM prescription_items_catalog
        WHERE branch_id = $1 AND deleted_at IS NULL AND is_active ORDER BY category, sort_order`,
      [doctor.branchId],
    )) as { id: string; category: string }[];
    const pick = (categories: string[], count: number) =>
      catalog
        .filter((c) => categories.includes(c.category))
        .slice(0, count)
        .map((c) => c.id);
    const medicines = pick(['supplement', 'medicine', 'glp'], 3);
    const treatments = pick(['bhrt'], 1);
    const tests = pick(['lab'], 3);

    for (const [index, visit] of VISITS.entries()) {
      const date = minus(visit.daysAgo);
      const appointment = await appointmentsService.create(
        actor,
        viewer,
        createAppointmentSchema.parse({
          patientId: patient.id,
          doctorId: doctor.id,
          date,
          timeFrom: '11:00',
          timeTo: '11:30',
          mode: 'physical',
          visitType: index === 0 ? 'new' : 'followup',
          issues: visit.issues,
        }),
      );
      const { consultation } = await consultationsService.open(actor, viewer, appointment.id);
      await consultationsService.saveSection(actor, viewer, consultation.id, 'clinical_assessment', {
        plan: visit.remarks,
      });
      await prescriptionsService.create(
        actor,
        viewer,
        createPrescriptionSchema.parse({
          consultationId: consultation.id,
          date,
          diagnosis: visit.diagnosis,
          planTreatment: visit.plan,
          followupDate: minus(visit.daysAgo - 30),
          items: [...medicines, ...(index === 1 ? treatments : []), ...tests].map((catalogItemId) => ({
            catalogItemId,
          })),
        }),
      );
      await appointmentsService.setStatus(
        actor,
        viewer,
        appointment.id,
        appointmentStatusSchema.parse({ status: 'completed' }),
      );
      console.log(`Visit on ${date} added with a prescription and clinical remarks`);
    }

    await doctorAppService.addPlan(actor, doctor.staffId, patient.id, {
      plan: '<p>Lose <strong>4 kg</strong> in 3 months.</p><ul><li>Protein with every meal</li><li>Sleep 7 hours</li></ul>',
      catalogItemIds: [],
    });
    await doctorAppService.addPlan(actor, doctor.staffId, patient.id, {
      plan: null,
      catalogItemIds: medicines,
    });
    await doctorAppService.addPlan(actor, doctor.staffId, patient.id, { plan: null, catalogItemIds: tests });
    console.log(
      `Done for ${patient.name} with ${doctor.name}: 2 visits and 3 plans (text, medicines, blood work)`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Adding demo visits failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
