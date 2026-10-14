import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import {
  dataEnvelope,
  errorResponses,
  jsonContent,
  sendCreated,
  sendNoContent,
  sendOk,
} from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { documentUpload } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { validate, validBody, validParams, validQuery } from '../../middleware/validate';
import { authenticatePatient, patientOf } from '../patient-app/patient-auth';
import { doctorChat, patientChat } from './chat.service';

const doctorParams = z.object({ doctorId: z.uuid() });
const conversationParams = z.object({ conversationId: z.uuid() });
const doctorFileParams = doctorParams.extend({ messageId: z.uuid() });
const conversationFileParams = conversationParams.extend({ messageId: z.uuid() });
const pageQuery = z.object({ before: z.iso.datetime({ offset: true }).optional() });
const messageBody = z.object({ body: z.string().trim().max(4000).optional() });
const pushTokenBody = registry.register(
  'PatientPushToken',
  z.object({
    token: z.string().trim().min(10).max(255),
    platform: z.enum(['ios', 'android', 'web']).nullable().optional(),
  }),
);

const message = registry.register(
  'ChatMessage',
  z.object({
    id: z.uuid(),
    sender: z.enum(['patient', 'doctor']),
    body: z.string().nullable(),
    file: z.object({ name: z.string(), type: z.string(), size: z.number().int() }).nullable(),
    createdAt: z.string(),
  }),
);
const page = z.object({ items: z.array(message), hasMore: z.boolean() });
const conversation = registry.register(
  'ChatConversation',
  z.object({
    id: z.uuid(),
    patient: z.object({ id: z.uuid(), name: z.string(), phone: z.string() }),
    lastMessage: z.string().nullable(),
    lastMessageAt: z.string(),
    unread: z.number().int(),
  }),
);
const signed = z.object({ url: z.string(), expiresIn: z.number() });
const patientDocs = { tags: ['Patient app'], security: [{ bearerAuth: [] }] };
const doctorDocs = securedDocs('Doctor chat');
const ok = (description: string, schema: z.ZodType) => ({
  200: { description, ...jsonContent(dataEnvelope(schema)) },
  ...errorResponses,
});
const upload = 'Send text in "body" and/or one PDF or photo (JPG, PNG, WebP, 10 MB) in "file" (multipart).';

registry.registerPath({
  ...patientDocs,
  method: 'get',
  path: '/patient/chats',
  summary: 'Every doctor the patient has seen, with the last message and unread count',
  responses: ok('Doctors', z.array(z.unknown())),
});
registry.registerPath({
  ...patientDocs,
  method: 'get',
  path: '/patient/chats/{doctorId}/messages',
  summary: 'Messages with one doctor, oldest first (50 per page; ?before= for older). Marks them read.',
  request: { params: doctorParams, query: pageQuery },
  responses: ok('Messages', page),
});
registry.registerPath({
  ...patientDocs,
  method: 'post',
  path: '/patient/chats/{doctorId}/messages',
  summary: `Message a doctor the patient has seen. ${upload}`,
  request: { params: doctorParams },
  responses: { 201: { description: 'Sent', ...jsonContent(dataEnvelope(message)) }, ...errorResponses },
});
registry.registerPath({
  ...patientDocs,
  method: 'get',
  path: '/patient/chats/{doctorId}/messages/{messageId}/file',
  summary: 'Two-minute link to a file in the chat',
  request: { params: doctorFileParams },
  responses: ok('Signed URL', signed),
});
registry.registerPath({
  ...patientDocs,
  method: 'post',
  path: '/patient/push-token',
  summary: 'Save the Expo push token of this phone for message notifications',
  request: { body: { content: { 'application/json': { schema: pushTokenBody } } } },
  responses: { 204: { description: 'Saved' }, ...errorResponses },
});
registry.registerPath({
  ...doctorDocs,
  method: 'get',
  path: '/branch/chats',
  summary: 'Doctor only: conversations with patients, newest first',
  responses: ok('Conversations', z.array(conversation)),
});
registry.registerPath({
  ...doctorDocs,
  method: 'get',
  path: '/branch/chats/{conversationId}/messages',
  summary: 'Doctor only: messages of one conversation (marks them read)',
  request: { params: conversationParams, query: pageQuery },
  responses: ok('Messages', page),
});
registry.registerPath({
  ...doctorDocs,
  method: 'post',
  path: '/branch/chats/{conversationId}/messages',
  summary: `Doctor only: reply to the patient, who gets a push notification. ${upload}`,
  request: { params: conversationParams },
  responses: { 201: { description: 'Sent', ...jsonContent(dataEnvelope(message)) }, ...errorResponses },
});
registry.registerPath({
  ...doctorDocs,
  method: 'get',
  path: '/branch/chats/{conversationId}/messages/{messageId}/file',
  summary: 'Doctor only: two-minute link to a file in the chat',
  request: { params: conversationFileParams },
  responses: ok('Signed URL', signed),
});

const messageLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 1_000 : 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'Too many messages. Try again later.')),
});

const doctorOnly: RequestHandler = (req, _res, next) =>
  req.auth?.role === 'doctor' ? next() : next(AppError.forbidden('Only doctors use patient messages'));

export const chatRouter = Router();

chatRouter.get('/patient/chats', authenticatePatient, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendOk(res, await patientChat.doctors(patientOf(req).patientId));
});

chatRouter.get('/patient/chats/unread', authenticatePatient, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendOk(res, await patientChat.unread(patientOf(req).patientId));
});

chatRouter.get(
  '/patient/chats/:doctorId/messages',
  authenticatePatient,
  validate({ params: doctorParams, query: pageQuery }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { doctorId } = validParams(req, doctorParams);
    sendOk(
      res,
      await patientChat.messages(patientOf(req).patientId, doctorId, validQuery(req, pageQuery).before),
    );
  },
);

chatRouter.post(
  '/patient/chats/:doctorId/messages',
  authenticatePatient,
  messageLimiter,
  documentUpload('file'),
  validate({ params: doctorParams, body: messageBody }),
  async (req, res) => {
    const { doctorId } = validParams(req, doctorParams);
    sendCreated(
      res,
      await patientChat.send(
        patientOf(req).patientId,
        doctorId,
        validBody(req, messageBody).body ?? null,
        req.file,
      ),
    );
  },
);

chatRouter.get(
  '/patient/chats/:doctorId/messages/:messageId/file',
  authenticatePatient,
  validate({ params: doctorFileParams }),
  async (req, res) => {
    const { doctorId, messageId } = validParams(req, doctorFileParams);
    sendOk(res, await patientChat.fileUrl(patientOf(req).patientId, doctorId, messageId));
  },
);

chatRouter.post(
  '/patient/push-token',
  authenticatePatient,
  validate({ body: pushTokenBody }),
  async (req, res) => {
    const { token, platform } = validBody(req, pushTokenBody);
    const session = patientOf(req);
    await patientChat.savePushToken(session.patientId, session.sessionId, token, platform ?? null);
    sendNoContent(res);
  },
);

chatRouter.get('/branch/chats', authenticate, doctorOnly, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  sendOk(res, await doctorChat.conversations(req.auth!.userId));
});

chatRouter.get(
  '/branch/chats/:conversationId/messages',
  authenticate,
  doctorOnly,
  validate({ params: conversationParams, query: pageQuery }),
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { conversationId } = validParams(req, conversationParams);
    sendOk(
      res,
      await doctorChat.messages(req.auth!.userId, conversationId, validQuery(req, pageQuery).before),
    );
  },
);

chatRouter.post(
  '/branch/chats/:conversationId/messages',
  authenticate,
  doctorOnly,
  documentUpload('file'),
  validate({ params: conversationParams, body: messageBody }),
  async (req, res) => {
    const { conversationId } = validParams(req, conversationParams);
    sendCreated(
      res,
      await doctorChat.send(
        req.auth!.userId,
        conversationId,
        validBody(req, messageBody).body ?? null,
        req.file,
      ),
    );
  },
);

chatRouter.get(
  '/branch/chats/:conversationId/messages/:messageId/file',
  authenticate,
  doctorOnly,
  validate({ params: conversationFileParams }),
  async (req, res) => {
    const { conversationId, messageId } = validParams(req, conversationFileParams);
    sendOk(res, await doctorChat.fileUrl(req.auth!.userId, conversationId, messageId));
  },
);
