import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { auditService } from '../audit/audit.service';
import { nextSequence } from '../sequences/sequences';

export const PATIENT_REQUEST_CATEGORIES = [
  'appointment',
  'prescription',
  'medicine_order',
  'billing',
  'profile_correction',
  'general',
  'other',
] as const;
export type PatientRequestCategory = (typeof PATIENT_REQUEST_CATEGORIES)[number];

export const PATIENT_REQUEST_STATUSES = [
  'submitted',
  'in_review',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type PatientRequestStatus = (typeof PATIENT_REQUEST_STATUSES)[number];

export const OPEN_REQUEST_STATUSES: readonly PatientRequestStatus[] = [
  'submitted',
  'in_review',
  'in_progress',
];

interface Row {
  id: string;
  requestNo: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  category: PatientRequestCategory;
  subject: string;
  message: string;
  status: PatientRequestStatus;
  reply: string | null;
  repliedAt: Date | null;
  repliedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EventRow {
  status: PatientRequestStatus;
  note: string | null;
  byPatient: boolean;
  actorName: string | null;
  createdAt: Date;
}

const SELECT = `
  SELECT r.id, r.request_no AS "requestNo", r.branch_id AS "branchId", b.name AS "branchName", b.code AS "branchCode",
         r.patient_id AS "patientId", p.name AS "patientName", p.phone AS "patientPhone",
         r.category, r.subject, r.message, r.status, r.reply, r.replied_at AS "repliedAt",
         NULLIF(TRIM(CONCAT(rb.first_name, ' ', rb.last_name)), '') AS "repliedByName",
         r.created_at AS "createdAt", r.updated_at AS "updatedAt"
    FROM patient_requests r
    JOIN branches b ON b.id = r.branch_id
    JOIN patients p ON p.id = r.patient_id
    LEFT JOIN staff_profiles rb ON rb.id = r.replied_by
   WHERE r.deleted_at IS NULL`;

async function eventsOf(requestId: string) {
  return (await AppDataSource.query(
    `SELECT e.status, e.note, e.by_patient AS "byPatient",
            NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS "actorName", e.created_at AS "createdAt"
       FROM patient_request_events e
       LEFT JOIN staff_profiles s ON s.id = e.actor_id AND e.by_patient = false
      WHERE e.request_id = $1
      ORDER BY e.created_at ASC`,
    [requestId],
  )) as EventRow[];
}

function toPatientDto(r: Row, events?: EventRow[]) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    category: r.category,
    subject: r.subject,
    message: r.message,
    status: r.status,
    reply: r.reply,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    branch: { name: r.branchName },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(events
      ? {
          history: events.map((e) => ({
            status: e.status,
            note: e.byPatient ? null : e.note,
            byPatient: e.byPatient,
            at: e.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

function toStaffDto(r: Row, events?: EventRow[]) {
  return {
    id: r.id,
    requestNo: r.requestNo,
    branch: { id: r.branchId, name: r.branchName, code: r.branchCode },
    patient: { id: r.patientId, name: r.patientName, phone: r.patientPhone },
    category: r.category,
    subject: r.subject,
    message: r.message,
    status: r.status,
    reply: r.reply,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    repliedBy: r.repliedByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(events
      ? {
          history: events.map((e) => ({
            status: e.status,
            note: e.note,
            byPatient: e.byPatient,
            by: e.byPatient ? 'Patient' : (e.actorName ?? 'Staff'),
            at: e.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

async function homeBranchOf(patientId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT COALESCE(
       (SELECT a.branch_id FROM appointments a WHERE a.patient_id = p.id AND a.deleted_at IS NULL
         ORDER BY a.date DESC, a.time_from DESC LIMIT 1),
       p.created_in_branch_id) AS "branchId"
       FROM patients p WHERE p.id = $1`,
    [patientId],
  )) as { branchId: string | null }[];
  if (!row?.branchId)
    throw AppError.badRequest('Your clinic branch could not be found. Please call the clinic.');
  return row.branchId;
}

export const patientRequestsService = {
  homeBranchOf,

  async listForPatient(patientId: string) {
    const rows = (await AppDataSource.query(
      `${SELECT} AND r.patient_id = $1 ORDER BY r.created_at DESC LIMIT 200`,
      [patientId],
    )) as Row[];
    return rows.map((r) => toPatientDto(r));
  },

  async getForPatient(patientId: string, id: string) {
    const [row] = (await AppDataSource.query(`${SELECT} AND r.id = $1 AND r.patient_id = $2`, [
      id,
      patientId,
    ])) as Row[];
    if (!row) throw AppError.notFound('Request');
    return toPatientDto(row, await eventsOf(row.id));
  },

  async create(
    patientId: string,
    input: { category: PatientRequestCategory; subject: string; message: string },
  ) {
    const branchId = await homeBranchOf(patientId);
    const id = await withTransaction(async (em) => {
      const [branch] = (await em.query(`SELECT code FROM branches WHERE id = $1`, [branchId])) as {
        code: string;
      }[];
      const seq = await nextSequence(em, branchId, 'patient_request');
      const requestNo = `${branch!.code}-PR-${String(seq).padStart(6, '0')}`;
      const [created] = (await em.query(
        `INSERT INTO patient_requests (branch_id, patient_id, request_no, category, subject, message)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [branchId, patientId, requestNo, input.category, input.subject, input.message],
      )) as { id: string }[];
      await em.query(
        `INSERT INTO patient_request_events (request_id, status, by_patient) VALUES ($1, 'submitted', true)`,
        [created!.id],
      );
      return created!.id;
    });
    return this.getForPatient(patientId, id);
  },

  async list(branchId: string | null, query: { status?: PatientRequestStatus | 'open'; patientId?: string }) {
    const params: unknown[] = [];
    let where = '';
    if (branchId) {
      params.push(branchId);
      where += ` AND r.branch_id = $${params.length}`;
    }
    if (query.status === 'open') where += ` AND r.status IN ('submitted', 'in_review', 'in_progress')`;
    else if (query.status) {
      params.push(query.status);
      where += ` AND r.status = $${params.length}`;
    }
    if (query.patientId) {
      params.push(query.patientId);
      where += ` AND r.patient_id = $${params.length}`;
    }
    const rows = (await AppDataSource.query(
      `${SELECT}${where} ORDER BY r.created_at DESC LIMIT 500`,
      params,
    )) as Row[];
    return rows.map((r) => toStaffDto(r));
  },

  async get(branchId: string | null, id: string) {
    const params: unknown[] = [id];
    if (branchId) params.push(branchId);
    const [row] = (await AppDataSource.query(
      `${SELECT} AND r.id = $1${branchId ? ' AND r.branch_id = $2' : ''}`,
      params,
    )) as Row[];
    if (!row) throw AppError.notFound('Patient request');
    return toStaffDto(row, await eventsOf(row.id));
  },

  async update(
    actor: Actor,
    branchId: string | null,
    id: string,
    input: { status?: PatientRequestStatus; reply?: string | null; note?: string | null },
  ) {
    const before = await this.get(branchId, id);
    const status = input.status ?? before.status;
    const replyChanged = input.reply !== undefined && (input.reply ?? null) !== before.reply;
    if (status === before.status && !replyChanged && !input.note) {
      throw AppError.badRequest('Change the status, the reply or add a note');
    }
    await withTransaction(async (em) => {
      await em.query(
        `UPDATE patient_requests SET status = $2, updated_by = $3, updated_at = now()
           ${replyChanged ? ', reply = $4, replied_by = $3, replied_at = now()' : ''}
         WHERE id = $1`,
        replyChanged ? [id, status, actor.userId, input.reply ?? null] : [id, status, actor.userId],
      );
      await em.query(
        `INSERT INTO patient_request_events (request_id, status, note, by_patient, actor_id)
         VALUES ($1, $2, $3, false, $4)`,
        [id, status, input.note ?? (replyChanged ? 'Management replied' : null), actor.userId],
      );
      await auditService.record(
        {
          actor,
          branchId: before.branch.id,
          action: 'update',
          entity: 'patient_request',
          entityId: id,
          before: { status: before.status },
          after: { status, replied: replyChanged },
        },
        em,
      );
    });
    return this.get(branchId, id);
  },

  async openCount(branchId: string | null) {
    const [row] = (await AppDataSource.query(
      `SELECT COUNT(*)::int AS count FROM patient_requests
        WHERE deleted_at IS NULL AND status IN ('submitted', 'in_review', 'in_progress')
          ${branchId ? 'AND branch_id = $1' : ''}`,
      branchId ? [branchId] : [],
    )) as { count: number }[];
    return row?.count ?? 0;
  },
};
