import { AppDataSource } from '../../database/data-source';
import { withTransaction } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { discardUploads, uploadMany } from '../../lib/file-uploads';
import { sendExpoPush } from '../../lib/push';
import { BUCKETS, createSignedUrl } from '../../lib/storage';

export type Sender = 'patient' | 'doctor';

const PAGE_SIZE = 50;

interface MessageRow {
  id: string;
  sender: Sender;
  body: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  createdAt: Date;
}

const MESSAGE_SELECT = `SELECT m.id, m.sender, m.body, m.file_name AS "fileName", m.file_type AS "fileType",
  m.file_size AS "fileSize", m.created_at AS "createdAt" FROM chat_messages m`;

const toMessage = (m: MessageRow) => ({
  id: m.id,
  sender: m.sender,
  body: m.body,
  file: m.fileName ? { name: m.fileName, type: m.fileType ?? '', size: m.fileSize ?? 0 } : null,
  createdAt: m.createdAt.toISOString(),
});

async function messages(conversationId: string, before?: string) {
  const params: unknown[] = [conversationId];
  let where = 'm.conversation_id = $1';
  if (before) {
    params.push(before);
    where += ` AND m.created_at < $${params.length}`;
  }
  const rows = (await AppDataSource.query(
    `${MESSAGE_SELECT} WHERE ${where} ORDER BY m.created_at DESC LIMIT ${PAGE_SIZE + 1}`,
    params,
  )) as MessageRow[];
  return {
    items: rows.slice(0, PAGE_SIZE).reverse().map(toMessage),
    hasMore: rows.length > PAGE_SIZE,
  };
}

async function patientHasDoctor(patientId: string, doctorId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT 1 FROM appointments a JOIN doctors d ON d.id = a.doctor_id AND d.deleted_at IS NULL
      WHERE a.patient_id = $1 AND a.doctor_id = $2 AND a.deleted_at IS NULL LIMIT 1`,
    [patientId, doctorId],
  )) as unknown[];
  return Boolean(row);
}

async function conversationFor(patientId: string, doctorId: string) {
  const [row] = (await AppDataSource.query(
    `INSERT INTO chat_conversations (patient_id, doctor_id) VALUES ($1, $2)
     ON CONFLICT (patient_id, doctor_id) DO UPDATE SET updated_at = chat_conversations.updated_at
     RETURNING id`,
    [patientId, doctorId],
  )) as { id: string }[];
  return row!.id;
}

async function doctorOf(staffId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT id FROM doctors WHERE staff_id = $1 AND deleted_at IS NULL`,
    [staffId],
  )) as { id: string }[];
  if (!row) throw AppError.forbidden('No doctor profile is linked to your account');
  return row.id;
}

async function doctorConversation(staffId: string, conversationId: string) {
  const doctorId = await doctorOf(staffId);
  const [row] = (await AppDataSource.query(
    `SELECT c.id, c.patient_id AS "patientId" FROM chat_conversations c WHERE c.id = $1 AND c.doctor_id = $2`,
    [conversationId, doctorId],
  )) as { id: string; patientId: string }[];
  if (!row) throw AppError.notFound('Conversation');
  return row;
}

function preview(body: string | null, fileName: string | null) {
  const text = body?.trim();
  if (text) return text.slice(0, 200);
  return `📎 ${fileName ?? 'File'}`.slice(0, 200);
}

async function send(
  conversationId: string,
  sender: Sender,
  staffId: string | null,
  body: string | null,
  file: Express.Multer.File | undefined,
) {
  const text = body?.trim() || null;
  if (!text && !file) throw AppError.badRequest('Write a message or attach a file');
  const uploaded = file ? await uploadMany(BUCKETS.medicalRecords, `chat/${conversationId}`, [file]) : [];
  const stored = uploaded[0];
  try {
    const row = await withTransaction(async (em) => {
      const [created] = (await em.query(
        `INSERT INTO chat_messages (conversation_id, sender, sender_staff_id, body, file_path, file_name, file_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sender, body, file_name AS "fileName", file_type AS "fileType", file_size AS "fileSize",
                   created_at AS "createdAt"`,
        [
          conversationId,
          sender,
          staffId,
          text,
          stored?.path ?? null,
          stored?.originalName ?? null,
          stored?.contentType ?? null,
          stored?.sizeBytes ?? null,
        ],
      )) as MessageRow[];
      await em.query(
        `UPDATE chat_conversations SET last_message_at = now(), last_message_preview = $2, updated_at = now(),
           ${sender === 'patient' ? 'doctor_unread = doctor_unread + 1' : 'patient_unread = patient_unread + 1'}
         WHERE id = $1`,
        [conversationId, preview(text, stored?.originalName ?? null)],
      );
      return created!;
    });
    return toMessage(row);
  } catch (err) {
    await discardUploads(uploaded);
    throw err;
  }
}

async function fileUrl(conversationId: string, messageId: string) {
  const [row] = (await AppDataSource.query(
    `SELECT file_path AS "filePath" FROM chat_messages WHERE id = $1 AND conversation_id = $2`,
    [messageId, conversationId],
  )) as { filePath: string | null }[];
  if (!row?.filePath) throw AppError.notFound('File');
  return createSignedUrl(BUCKETS.medicalRecords, row.filePath, 120);
}

export const patientChat = {
  async doctors(patientId: string) {
    const rows = (await AppDataSource.query(
      `SELECT d.id AS "doctorId", d.display_name AS name, d.details,
              c.id AS "conversationId", c.last_message_at AS "lastMessageAt",
              c.last_message_preview AS "lastMessage", COALESCE(c.patient_unread, 0) AS unread,
              MAX(a.date)::text AS "lastVisit"
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id AND d.deleted_at IS NULL
         LEFT JOIN chat_conversations c ON c.patient_id = a.patient_id AND c.doctor_id = d.id
        WHERE a.patient_id = $1 AND a.deleted_at IS NULL
        GROUP BY d.id, d.display_name, d.details, c.id, c.last_message_at, c.last_message_preview, c.patient_unread
        ORDER BY c.last_message_at DESC NULLS LAST, d.display_name ASC`,
      [patientId],
    )) as {
      doctorId: string;
      name: string;
      details: string | null;
      conversationId: string | null;
      lastMessageAt: Date | null;
      lastMessage: string | null;
      unread: number;
      lastVisit: string | null;
    }[];
    return rows.map((r) => ({
      doctorId: r.doctorId,
      name: r.name,
      details: r.details,
      lastVisit: r.lastVisit,
      lastMessage: r.lastMessage,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      unread: Number(r.unread),
    }));
  },

  async unread(patientId: string) {
    const [row] = (await AppDataSource.query(
      `SELECT COALESCE(SUM(patient_unread), 0)::int AS unread FROM chat_conversations WHERE patient_id = $1`,
      [patientId],
    )) as { unread: number }[];
    return { unread: row?.unread ?? 0 };
  },

  async messages(patientId: string, doctorId: string, before?: string) {
    if (!(await patientHasDoctor(patientId, doctorId))) throw AppError.notFound('Doctor');
    const [conversation] = (await AppDataSource.query(
      `SELECT id FROM chat_conversations WHERE patient_id = $1 AND doctor_id = $2`,
      [patientId, doctorId],
    )) as { id: string }[];
    if (!conversation) return { items: [], hasMore: false };
    if (!before) {
      await AppDataSource.query(`UPDATE chat_conversations SET patient_unread = 0 WHERE id = $1`, [
        conversation.id,
      ]);
    }
    return messages(conversation.id, before);
  },

  async send(patientId: string, doctorId: string, body: string | null, file?: Express.Multer.File) {
    if (!(await patientHasDoctor(patientId, doctorId))) throw AppError.notFound('Doctor');
    const conversationId = await conversationFor(patientId, doctorId);
    return send(conversationId, 'patient', null, body, file);
  },

  async fileUrl(patientId: string, doctorId: string, messageId: string) {
    const [conversation] = (await AppDataSource.query(
      `SELECT id FROM chat_conversations WHERE patient_id = $1 AND doctor_id = $2`,
      [patientId, doctorId],
    )) as { id: string }[];
    if (!conversation) throw AppError.notFound('File');
    return fileUrl(conversation.id, messageId);
  },

  async files(patientId: string, doctorId: string) {
    if (!(await patientHasDoctor(patientId, doctorId))) throw AppError.notFound('Doctor');
    const rows = (await AppDataSource.query(
      `${MESSAGE_SELECT} JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE c.patient_id = $1 AND c.doctor_id = $2 AND m.file_path IS NOT NULL
        ORDER BY m.created_at DESC LIMIT 200`,
      [patientId, doctorId],
    )) as MessageRow[];
    return rows.map(toMessage);
  },

  async savePushToken(patientId: string, sessionId: string, token: string, platform: string | null) {
    await AppDataSource.query(
      `INSERT INTO patient_push_tokens (patient_id, session_id, token, platform) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET patient_id = EXCLUDED.patient_id, session_id = EXCLUDED.session_id,
         platform = EXCLUDED.platform, updated_at = now()`,
      [patientId, sessionId, token, platform],
    );
  },
};

export const doctorChat = {
  async conversations(staffId: string) {
    const doctorId = await doctorOf(staffId);
    const rows = (await AppDataSource.query(
      `SELECT c.id, p.id AS "patientId", p.name AS "patientName", p.phone AS "patientPhone",
              c.last_message_at AS "lastMessageAt", c.last_message_preview AS "lastMessage", c.doctor_unread AS unread
         FROM chat_conversations c JOIN patients p ON p.id = c.patient_id AND p.deleted_at IS NULL
        WHERE c.doctor_id = $1 AND c.last_message_at IS NOT NULL
        ORDER BY c.last_message_at DESC`,
      [doctorId],
    )) as {
      id: string;
      patientId: string;
      patientName: string;
      patientPhone: string;
      lastMessageAt: Date;
      lastMessage: string | null;
      unread: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      patient: { id: r.patientId, name: r.patientName, phone: r.patientPhone },
      lastMessage: r.lastMessage,
      lastMessageAt: r.lastMessageAt.toISOString(),
      unread: Number(r.unread),
    }));
  },

  async unread(staffId: string) {
    const [row] = (await AppDataSource.query(
      `SELECT COALESCE(SUM(c.doctor_unread), 0)::int AS unread FROM chat_conversations c
         JOIN doctors d ON d.id = c.doctor_id WHERE d.staff_id = $1 AND d.deleted_at IS NULL`,
      [staffId],
    )) as { unread: number }[];
    return row?.unread ?? 0;
  },

  async messages(staffId: string, conversationId: string, before?: string) {
    const conversation = await doctorConversation(staffId, conversationId);
    if (!before) {
      await AppDataSource.query(`UPDATE chat_conversations SET doctor_unread = 0 WHERE id = $1`, [
        conversation.id,
      ]);
    }
    return messages(conversation.id, before);
  },

  async send(staffId: string, conversationId: string, body: string | null, file?: Express.Multer.File) {
    const conversation = await doctorConversation(staffId, conversationId);
    const message = await send(conversation.id, 'doctor', staffId, body, file);
    const tokens = (await AppDataSource.query(`SELECT token FROM patient_push_tokens WHERE patient_id = $1`, [
      conversation.patientId,
    ])) as { token: string }[];
    await sendExpoPush(
      tokens.map((t) => t.token),
      {
        title: 'DSM Clinic',
        body: 'You have a new message from your doctor.',
        data: { type: 'chat' },
      },
    );
    return message;
  },

  async fileUrl(staffId: string, conversationId: string, messageId: string) {
    const conversation = await doctorConversation(staffId, conversationId);
    return fileUrl(conversation.id, messageId);
  },
};
