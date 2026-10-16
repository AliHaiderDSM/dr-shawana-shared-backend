import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../lib/actor';
import { dataEnvelope, errorResponses, jsonContent, sendNoContent, sendOk } from '../../lib/http';
import { registry } from '../../lib/openapi';
import { securedDocs } from '../../lib/openapi-crud';
import { documentsUpload, uploadedFiles } from '../../lib/upload';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/requireRole';
import { validate, validParams } from '../../middleware/validate';
import { authenticatePatient, patientOf } from '../patient-app/patient-auth';
import { educationalResourcesService, RESOURCE_KEYS } from './educational-resources.service';

const keyParams = z.object({ key: z.enum(RESOURCE_KEYS as [string, ...string[]]) });
const fileParams = z.object({ id: z.uuid() });

const resourceFile = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  size: z.number().int(),
  createdAt: z.string(),
});
const resource = registry.register(
  'EducationalResource',
  z.object({
    key: z.enum(RESOURCE_KEYS as [string, ...string[]]),
    label: z.string(),
    files: z.array(resourceFile),
  }),
);
const signed = z.object({ url: z.string(), expiresIn: z.number() });
const adminDocs = securedDocs('Educational resources');
const patientDocs = { tags: ['Patient app'], security: [{ bearerAuth: [] }] };
const ok = (description: string, schema: z.ZodType) => ({
  200: { description, ...jsonContent(dataEnvelope(schema)) },
  ...errorResponses,
});

registry.registerPath({
  ...adminDocs,
  method: 'get',
  path: '/admin/educational-resources',
  summary: 'Super Admin: the five educational resources with their files',
  responses: ok('Resources', z.array(resource)),
});
registry.registerPath({
  ...adminDocs,
  method: 'post',
  path: '/admin/educational-resources/{key}/files',
  summary: 'Super Admin: add up to 5 PDFs or photos (10 MB each) to a resource, multipart field "files"',
  request: { params: keyParams },
  responses: ok('Resource', resource),
});
registry.registerPath({
  ...adminDocs,
  method: 'delete',
  path: '/admin/educational-resources/files/{id}',
  summary: 'Super Admin: remove a file',
  request: { params: fileParams },
  responses: { 204: { description: 'Removed' }, ...errorResponses },
});
registry.registerPath({
  ...adminDocs,
  method: 'get',
  path: '/admin/educational-resources/files/{id}/url',
  summary: 'Super Admin: ten-minute link to a file',
  request: { params: fileParams },
  responses: ok('Signed URL', signed),
});
registry.registerPath({
  ...patientDocs,
  method: 'get',
  path: '/patient/resources/files/{id}/url',
  summary: 'Ten-minute link to a file of a resource the doctor recommended to this patient',
  request: { params: fileParams },
  responses: ok('Signed URL', signed),
});

export const educationalResourcesRouter = Router();

educationalResourcesRouter.get(
  '/admin/educational-resources',
  authenticate,
  requireRole(),
  async (_req, res) => {
    sendOk(res, await educationalResourcesService.list());
  },
);

educationalResourcesRouter.post(
  '/admin/educational-resources/:key/files',
  authenticate,
  requireRole(),
  documentsUpload('files'),
  validate({ params: keyParams }),
  async (req, res) => {
    const { key } = validParams(req, keyParams);
    sendOk(
      res,
      await educationalResourcesService.upload(
        actorFrom(req),
        key as (typeof RESOURCE_KEYS)[number],
        uploadedFiles(req),
      ),
    );
  },
);

educationalResourcesRouter.delete(
  '/admin/educational-resources/files/:id',
  authenticate,
  requireRole(),
  validate({ params: fileParams }),
  async (req, res) => {
    await educationalResourcesService.remove(actorFrom(req), validParams(req, fileParams).id);
    sendNoContent(res);
  },
);

educationalResourcesRouter.get(
  '/admin/educational-resources/files/:id/url',
  authenticate,
  requireRole(),
  validate({ params: fileParams }),
  async (req, res) => {
    sendOk(res, await educationalResourcesService.fileUrl(validParams(req, fileParams).id));
  },
);

educationalResourcesRouter.get(
  '/patient/resources/files/:id/url',
  authenticatePatient,
  validate({ params: fileParams }),
  async (req, res) => {
    sendOk(
      res,
      await educationalResourcesService.patientFileUrl(
        patientOf(req).patientId,
        validParams(req, fileParams).id,
      ),
    );
  },
);
