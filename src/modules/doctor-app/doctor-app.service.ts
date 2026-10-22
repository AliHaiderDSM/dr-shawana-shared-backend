import { AppDataSource } from '../../database/data-source';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { today } from '../../lib/validation';
import { authService } from '../auth/auth.service';
import { BLOOD_TESTS } from '../clinical-records/blood-work-result.entity';
import { BLOOD_TEST_UNITS } from '../clinical-records/clinical-records.schemas';
import { medicalRecordsService } from '../clinical-records/clinical-records.service';
import { consultationsService } from '../consultations/consultations.service';
import { doctorsService } from '../doctors/doctors.service';

interface DoctorRow {
  id: string;
  name: string;
  details: string | null;
  branchId: string;
  branchName: string;
}

async function doctorOf(staffId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT d.id, d.display_name AS name, d.details, d.branch_id AS "branchId", b.name AS "branchName"
       FROM doctors d JOIN branches b ON b.id = d.branch_id
      WHERE d.staff_id = $1 AND d.deleted_at IS NULL`,
    [staffId],
  )) as DoctorRow[];
  if (!row) throw AppError.forbidden('No doctor profile is linked to your account');
  return row;
}

async function assertOwnPatient(doctorId: string, patientId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT 1 FROM patients p
      WHERE p.id = $2 AND p.deleted_at IS NULL
        AND (EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.doctor_id = $1 AND a.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM chat_conversations c WHERE c.patient_id = p.id AND c.doctor_id = $1))`,
    [doctorId, patientId],
  )) as unknown[];
  if (!row) throw AppError.notFound('Patient');
}

export interface DoctorProfileInput {
  displayName?: string;
  details?: string | null;
  phone?: string | null;
  firstName?: string;
  lastName?: string;
}

function bloodWork(rows: { test: string; date: string; value: string; unit: string }[]) {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const tests = BLOOD_TESTS.filter((test) => rows.some((r) => r.test === test)).map((test) => {
    const mine = rows.filter((r) => r.test === test);
    return {
      test,
      unit: mine[mine.length - 1]?.unit ?? BLOOD_TEST_UNITS[test],
      points: [
        ...new Map(mine.map((r) => [r.date, { date: r.date, value: Number(r.value) }] as const)).values(),
      ],
    };
  });
  return { dates, tests };
}

const APPOINTMENT_PAGE = 30;

const iso = (value: Date | string | null) =>
  value === null ? null : value instanceof Date ? value.toISOString() : String(value);

export const doctorAppService = {
  async home(staffId: string) {
    const doctor = await doctorOf(staffId);
    const on = today();
    const [counts] = (await AppDataSource.query(
      `SELECT
         (SELECT COUNT(DISTINCT patient_id)::int FROM appointments WHERE doctor_id = $1 AND deleted_at IS NULL) AS patients,
         (SELECT COUNT(*)::int FROM appointments WHERE doctor_id = $1 AND deleted_at IS NULL) AS appointments,
         (SELECT COUNT(*)::int FROM appointments WHERE doctor_id = $1 AND deleted_at IS NULL AND date = $2::date
            AND status <> 'cancelled') AS today,
         (SELECT COUNT(*)::int FROM appointments WHERE doctor_id = $1 AND deleted_at IS NULL AND date = $2::date
            AND status = 'completed') AS "completedToday",
         (SELECT COUNT(*)::int FROM appointments WHERE doctor_id = $1 AND deleted_at IS NULL AND date > $2::date
            AND status = 'booked') AS upcoming,
         (SELECT COALESCE(SUM(doctor_unread), 0)::int FROM chat_conversations WHERE doctor_id = $1) AS unread`,
      [doctor.id, on],
    )) as {
      patients: number;
      appointments: number;
      today: number;
      completedToday: number;
      upcoming: number;
      unread: number;
    }[];
    const schedule = (await AppDataSource.query(
      `SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS date, a.time_from::text AS "timeFrom",
              a.time_to::text AS "timeTo", a.status, a.visit_type AS "visitType", a.mode,
              p.id AS "patientId", p.name AS "patientName", p.phone AS "patientPhone", b.name AS "branchName"
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.deleted_at IS NULL
         JOIN branches b ON b.id = a.branch_id
        WHERE a.doctor_id = $1 AND a.deleted_at IS NULL AND a.date >= $2::date AND a.status <> 'cancelled'
        ORDER BY a.date, a.time_from
        LIMIT 12`,
      [doctor.id, on],
    )) as {
      id: string;
      appointmentNo: number;
      date: string;
      timeFrom: string;
      timeTo: string;
      status: string;
      visitType: string;
      mode: string;
      patientId: string;
      patientName: string;
      patientPhone: string;
      branchName: string;
    }[];
    const chats = (await AppDataSource.query(
      `SELECT c.id, p.id AS "patientId", p.name AS "patientName", c.last_message_preview AS "lastMessage",
              c.last_message_at AS "lastMessageAt", c.doctor_unread AS unread
         FROM chat_conversations c JOIN patients p ON p.id = c.patient_id AND p.deleted_at IS NULL
        WHERE c.doctor_id = $1 AND c.last_message_at IS NOT NULL
        ORDER BY c.last_message_at DESC
        LIMIT 5`,
      [doctor.id],
    )) as {
      id: string;
      patientId: string;
      patientName: string;
      lastMessage: string | null;
      lastMessageAt: Date;
      unread: number;
    }[];
    return {
      doctor: { id: doctor.id, name: doctor.name, details: doctor.details, branch: doctor.branchName },
      counts: counts!,
      schedule: schedule.map((a) => ({
        id: a.id,
        appointmentNo: a.appointmentNo,
        date: a.date,
        timeFrom: a.timeFrom.slice(0, 5),
        timeTo: a.timeTo.slice(0, 5),
        status: a.status,
        visitType: a.visitType,
        mode: a.mode,
        branch: a.branchName,
        patient: { id: a.patientId, name: a.patientName, phone: a.patientPhone },
      })),
      chats: chats.map((c) => ({
        conversationId: c.id,
        patient: { id: c.patientId, name: c.patientName },
        lastMessage: c.lastMessage,
        lastMessageAt: iso(c.lastMessageAt),
        unread: Number(c.unread),
      })),
    };
  },

  async appointments(staffId: string, when: 'upcoming' | 'past', page: number) {
    const doctor = await doctorOf(staffId);
    const size = APPOINTMENT_PAGE;
    const upcoming = when === 'upcoming';
    const rows = (await AppDataSource.query(
      `SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS date, a.time_from::text AS "timeFrom",
              a.time_to::text AS "timeTo", a.status, a.visit_type AS "visitType", a.mode, a.issues,
              p.id AS "patientId", p.name AS "patientName", p.phone AS "patientPhone", b.name AS "branchName"
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id AND p.deleted_at IS NULL
         JOIN branches b ON b.id = a.branch_id
        WHERE a.doctor_id = $1 AND a.deleted_at IS NULL
          AND ${upcoming ? 'a.date >= $2::date' : 'a.date < $2::date'}
        ORDER BY a.date ${upcoming ? 'ASC' : 'DESC'}, a.time_from ${upcoming ? 'ASC' : 'DESC'}
        LIMIT $3 OFFSET $4`,
      [doctor.id, today(), size + 1, (page - 1) * size],
    )) as {
      id: string;
      appointmentNo: number;
      date: string;
      timeFrom: string;
      timeTo: string;
      status: string;
      visitType: string;
      mode: string;
      issues: string | null;
      patientId: string;
      patientName: string;
      patientPhone: string;
      branchName: string;
    }[];
    return {
      items: rows.slice(0, size).map((a) => ({
        id: a.id,
        appointmentNo: a.appointmentNo,
        date: a.date,
        timeFrom: a.timeFrom.slice(0, 5),
        timeTo: a.timeTo.slice(0, 5),
        status: a.status,
        visitType: a.visitType,
        mode: a.mode,
        issues: a.issues,
        branch: a.branchName,
        patient: { id: a.patientId, name: a.patientName, phone: a.patientPhone },
      })),
      page,
      hasMore: rows.length > size,
    };
  },

  async patients(staffId: string, search?: string) {
    const doctor = await doctorOf(staffId);
    const term = search?.trim();
    const params: unknown[] = [doctor.id, today()];
    let filter = '';
    if (term) {
      params.push(`%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      filter = `AND (p.name ILIKE $3 OR p.phone ILIKE $3)`;
    }
    const rows = (await AppDataSource.query(
      `SELECT p.id, p.name, p.phone, p.city, p.age,
              MAX(a.date) FILTER (WHERE a.date <= $2::date AND a.status <> 'cancelled')::text AS "lastVisit",
              MIN(a.date) FILTER (WHERE a.date >= $2::date AND a.status = 'booked')::text AS "nextVisit",
              COUNT(a.id) FILTER (WHERE a.status <> 'cancelled')::int AS visits,
              c.id AS "conversationId", COALESCE(c.doctor_unread, 0)::int AS unread,
              c.last_message_preview AS "lastMessage", c.last_message_at AS "lastMessageAt"
         FROM patients p
         LEFT JOIN appointments a ON a.patient_id = p.id AND a.doctor_id = $1 AND a.deleted_at IS NULL
         LEFT JOIN chat_conversations c ON c.patient_id = p.id AND c.doctor_id = $1
        WHERE p.deleted_at IS NULL AND (a.id IS NOT NULL OR c.id IS NOT NULL) ${filter}
        GROUP BY p.id, c.id
        ORDER BY COALESCE(c.doctor_unread, 0) > 0 DESC, c.last_message_at DESC NULLS LAST, MAX(a.date) DESC NULLS LAST
        LIMIT 300`,
      params,
    )) as {
      id: string;
      name: string;
      phone: string;
      city: string;
      age: number | null;
      lastVisit: string | null;
      nextVisit: string | null;
      visits: number;
      conversationId: string | null;
      unread: number;
      lastMessage: string | null;
      lastMessageAt: Date | null;
    }[];
    return rows.map((r) => ({ ...r, lastMessageAt: iso(r.lastMessageAt) }));
  },

  async openChat(staffId: string, patientId: string) {
    const doctor = await doctorOf(staffId);
    await assertOwnPatient(doctor.id, patientId);
    const [row] = (await AppDataSource.query(
      `INSERT INTO chat_conversations (patient_id, doctor_id) VALUES ($1, $2)
       ON CONFLICT (patient_id, doctor_id) DO UPDATE SET updated_at = chat_conversations.updated_at
       RETURNING id`,
      [patientId, doctor.id],
    )) as { id: string }[];
    return { conversationId: row!.id };
  },

  async patientFile(staffId: string, patientId: string) {
    const doctor = await doctorOf(staffId);
    await assertOwnPatient(doctor.id, patientId);
    const [patient] = (await AppDataSource.query(
      `SELECT id, name, phone, age, date_of_birth::text AS "dateOfBirth", city, country,
              weight_kg::text AS "weightKg", height_cm::text AS "heightCm"
         FROM patients WHERE id = $1`,
      [patientId],
    )) as Record<string, unknown>[];
    const [appointments, prescriptions, items, remarks, records, conversation, blood] = await Promise.all([
      AppDataSource.query(
        `SELECT a.id, a.appointment_no AS "appointmentNo", a.date::text AS date, a.time_from::text AS "timeFrom",
                a.time_to::text AS "timeTo", a.status, a.visit_type AS "visitType", a.mode, a.issues, a.remark,
                d.display_name AS doctor, b.name AS branch, (a.doctor_id = $2) AS mine
           FROM appointments a
           JOIN branches b ON b.id = a.branch_id
           LEFT JOIN doctors d ON d.id = a.doctor_id
          WHERE a.patient_id = $1 AND a.deleted_at IS NULL
          ORDER BY a.date DESC, a.time_from DESC`,
        [patientId, doctor.id],
      ) as Promise<Record<string, unknown>[]>,
      AppDataSource.query(
        `SELECT p.id, p.prescription_no AS "prescriptionNo", p.date::text AS date, p.diagnosis,
                p.followup_date::text AS "followupDate", p.plan_treatment AS "planTreatment",
                p.consultation_id AS "consultationId", d.display_name AS doctor, b.name AS branch
           FROM prescriptions p
           LEFT JOIN doctors d ON d.id = p.doctor_id
           LEFT JOIN branches b ON b.id = p.branch_id
          WHERE p.patient_id = $1 AND p.deleted_at IS NULL
          ORDER BY p.date DESC, p.prescription_no DESC`,
        [patientId],
      ) as Promise<{ id: string } & Record<string, unknown>[]>,
      AppDataSource.query(
        `SELECT i.prescription_id AS "prescriptionId", i.group_name AS "groupName", i.name, i.dose, i.instructions
           FROM prescription_items i JOIN prescriptions p ON p.id = i.prescription_id
          WHERE p.patient_id = $1 AND p.deleted_at IS NULL AND i.deleted_at IS NULL
          ORDER BY i.sort_order`,
        [patientId],
      ) as Promise<{ prescriptionId: string } & Record<string, unknown>[]>,
      AppDataSource.query(
        `SELECT c.id AS "consultationId", a.date::text AS date, a.appointment_no AS "appointmentNo",
                d.display_name AS doctor, b.name AS branch, NULLIF(TRIM(cs.data->>'plan'), '') AS remarks,
                cs.updated_at AS "updatedAt", (c.doctor_id = $2) AS editable
           FROM consultations c
           JOIN appointments a ON a.id = c.appointment_id
           LEFT JOIN doctors d ON d.id = c.doctor_id
           LEFT JOIN branches b ON b.id = c.branch_id
           LEFT JOIN consultation_sections cs ON cs.consultation_id = c.id
                 AND cs.section_key = 'clinical_assessment' AND cs.deleted_at IS NULL
          WHERE c.patient_id = $1 AND c.deleted_at IS NULL
            AND (c.doctor_id = $2 OR NULLIF(TRIM(cs.data->>'plan'), '') IS NOT NULL)
          ORDER BY a.date DESC, a.time_from DESC`,
        [patientId, doctor.id],
      ) as Promise<Record<string, unknown>[]>,
      medicalRecordsService.timeline(null, patientId),
      AppDataSource.query(`SELECT id FROM chat_conversations WHERE patient_id = $1 AND doctor_id = $2`, [
        patientId,
        doctor.id,
      ]) as Promise<{ id: string }[]>,
      AppDataSource.query(
        `SELECT test, test_date::text AS date, value::text AS value, unit FROM blood_work_results
          WHERE patient_id = $1 AND deleted_at IS NULL
          ORDER BY test_date, created_at`,
        [patientId],
      ) as Promise<{ test: string; date: string; value: string; unit: string }[]>,
    ]);
    const branchIds = [...new Set(records.map((r) => r.branchId))];
    const branchNames = new Map(
      (
        (await AppDataSource.query(`SELECT id, name FROM branches WHERE id = ANY($1::uuid[])`, [
          branchIds,
        ])) as { id: string; name: string }[]
      ).map((b) => [b.id, b.name]),
    );
    return {
      patient,
      conversationId: conversation[0]?.id ?? null,
      appointments: appointments.map((a) => ({
        ...a,
        timeFrom: String(a.timeFrom).slice(0, 5),
        timeTo: String(a.timeTo).slice(0, 5),
        mine: a.mine === true,
      })),
      prescriptions: (prescriptions as unknown as Record<string, unknown>[]).map((p) => ({
        ...p,
        items: (items as unknown as Record<string, unknown>[])
          .filter((i) => i.prescriptionId === p.id)
          .map(({ prescriptionId: _id, ...i }) => i),
      })),
      remarks: remarks.map((r) => ({
        ...r,
        updatedAt: iso(r.updatedAt as Date | null),
        editable: r.editable === true,
      })),
      records: records.map((r) => ({
        id: r.id,
        type: r.type,
        date: r.date,
        note: r.note,
        uploadedByPatient: r.uploadedByPatient,
        branch: branchNames.get(r.branchId) ?? null,
        createdAt: iso(r.createdAt),
        files: r.files.map((f) => ({ id: f.id, name: f.originalName, contentType: f.contentType })),
      })),
      bloodWork: bloodWork(blood),
    };
  },

  async profile(staffId: string) {
    const doctor = await doctorOf(staffId);
    const [row] = (await AppDataSource.query(
      `SELECT d.phone, s.first_name AS "firstName", s.last_name AS "lastName", s.email, s.username,
              s.phone AS "loginPhone"
         FROM doctors d JOIN staff_profiles s ON s.id = d.staff_id
        WHERE d.id = $1`,
      [doctor.id],
    )) as {
      phone: string | null;
      firstName: string;
      lastName: string;
      email: string;
      username: string;
      loginPhone: string | null;
    }[];
    return {
      id: doctor.id,
      displayName: doctor.name,
      details: doctor.details,
      branch: doctor.branchName,
      phone: row?.loginPhone ?? row?.phone ?? null,
      firstName: row?.firstName ?? '',
      lastName: row?.lastName ?? '',
      email: row?.email ?? '',
      username: row?.username ?? '',
    };
  },

  async updateProfile(actor: Actor, staffId: string, input: DoctorProfileInput) {
    const doctor = await doctorOf(staffId);
    const { displayName, details, phone, firstName, lastName } = input;
    const forDoctor = Object.fromEntries(
      Object.entries({ displayName, details, phone }).filter(([, v]) => v !== undefined),
    );
    const forStaff = Object.fromEntries(
      Object.entries({ firstName, lastName, phone }).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(forDoctor).length)
      await doctorsService.update(actor, doctor.branchId, doctor.id, forDoctor);
    if (Object.keys(forStaff).length) await authService.updateOwnProfile(actor, forStaff);
    return this.profile(staffId);
  },

  async fileUrl(staffId: string, patientId: string, fileId: string) {
    const doctor = await doctorOf(staffId);
    await assertOwnPatient(doctor.id, patientId);
    const [file] = (await AppDataSource.query(
      `SELECT f.file_path AS path FROM medical_record_files f
         JOIN medical_records r ON r.id = f.medical_record_id AND r.deleted_at IS NULL
        WHERE f.id = $1 AND r.patient_id = $2 AND f.deleted_at IS NULL`,
      [fileId, patientId],
    )) as { path: string }[];
    if (!file) throw AppError.notFound('File');
    return createSignedUrl(BUCKETS.medicalRecords, file.path, 600);
  },

  async saveRemarks(actor: Actor, staffId: string, consultationId: string, remarks: string | null) {
    const doctor = await doctorOf(staffId);
    const [consultation] = (await AppDataSource.query(
      `SELECT c.branch_id AS "branchId", cs.data FROM consultations c
         LEFT JOIN consultation_sections cs ON cs.consultation_id = c.id
               AND cs.section_key = 'clinical_assessment' AND cs.deleted_at IS NULL
        WHERE c.id = $1 AND c.doctor_id = $2 AND c.deleted_at IS NULL`,
      [consultationId, doctor.id],
    )) as { branchId: string; data: Record<string, unknown> | null }[];
    if (!consultation) throw AppError.notFound('Consultation');
    await consultationsService.saveSection(
      actor,
      { branchId: consultation.branchId, doctorId: doctor.id },
      consultationId,
      'clinical_assessment',
      { ...(consultation.data ?? {}), plan: remarks },
    );
    return { consultationId, remarks };
  },

  async savePushToken(staffId: string, token: string, platform: string | null) {
    await doctorOf(staffId);
    await AppDataSource.query(
      `INSERT INTO staff_push_tokens (staff_id, token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET staff_id = EXCLUDED.staff_id, platform = EXCLUDED.platform, updated_at = now()`,
      [staffId, token, platform],
    );
  },

  async removePushToken(staffId: string, token: string) {
    await AppDataSource.query(`DELETE FROM staff_push_tokens WHERE staff_id = $1 AND token = $2`, [
      staffId,
      token,
    ]);
  },
};
