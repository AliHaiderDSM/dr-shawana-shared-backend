import { type EntityManager, type EntityTarget } from 'typeorm';
import { branchScopedRepository } from '../../database/branch-scoped.repository';
import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { AppError } from '../../lib/errors';
import { withoutInternals } from '../../lib/http';
import { paginate } from '../../lib/pagination';
import { discardUploads, uploadMany, type UploadedFile } from '../../lib/file-uploads';
import { BUCKETS, createSignedUrl } from '../../lib/storage';
import { auditService } from '../audit/audit.service';
import { type SupplierType } from '../suppliers/supplier.entity';
import { suppliersService } from '../suppliers/suppliers.service';
import { StockAttachment, type StockDocumentType } from './stock-attachment.entity';
import { type StockIn } from './stock-in.entity';
import { stockLedger } from './stock-ledger';
import { type StockDocumentListQuery } from './stock-documents.schemas';
import { type StockOut } from './stock-out.entity';

type StockDocument = StockIn | StockOut;

interface DocumentConfig<T extends StockDocument> {
  kind: StockDocumentType;
  entity: EntityTarget<T>;
  label: string;
  partyKey: 'supplierId' | 'dispatcherId';
  partyRelation: 'supplier' | 'dispatcher';
  partyType: SupplierType;
  sign: 1 | -1;
  destinationFilter: boolean;
}

interface CreateInput {
  date: string;
  note?: string | null;
  supplierId?: string | null;
  dispatcherId?: string | null;
  items: ({ productId: string; qty: string } & Record<string, unknown>)[];
}

type UpdateInput = Partial<Record<string, unknown>> & { productId?: string; qty?: string; date?: string };

const attachments = branchScopedRepository(StockAttachment, 'att');

function toAttachmentDto(a: StockAttachment) {
  return {
    id: a.id,
    originalName: a.originalName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt,
  };
}

const uploadAll = (branchId: string, kind: StockDocumentType, files: Express.Multer.File[]) =>
  uploadMany(BUCKETS.stockFiles, `${branchId}/${kind}`, files);

export function createStockDocumentService<T extends StockDocument>(config: DocumentConfig<T>) {
  const base = branchScopedRepository(config.entity, 'd');
  const referenceType = config.kind;

  const ledgerRef = (actor: Actor, record: T) => ({
    branchId: record.branchId,
    referenceType,
    referenceId: record.id,
    actorId: actor.userId,
  });

  const movementFor = (record: T) => ({
    productId: record.productId,
    type: config.kind,
    qty: record.qty.times(config.sign),
    date: record.date,
    note: record.note,
  });

  async function attachmentsFor(branchId: string, ids: string[], manager?: EntityManager) {
    if (ids.length === 0) return new Map<string, StockAttachment[]>();
    const rows = await attachments
      .query(branchId, manager)
      .andWhere('att.documentType = :kind', { kind: config.kind })
      .andWhere('att.documentId IN (:...ids)', { ids })
      .orderBy('att.createdAt', 'ASC')
      .getMany();
    const grouped = new Map<string, StockAttachment[]>();
    for (const row of rows) grouped.set(row.documentId, [...(grouped.get(row.documentId) ?? []), row]);
    return grouped;
  }

  function toDto(record: T, files: StockAttachment[] = []) {
    const plain = withoutInternals(record) as Record<string, unknown>;
    const party = plain[config.partyRelation] as { id: string; name: string } | null | undefined;
    const product = record.product;
    return {
      ...plain,
      product: product ? { id: product.id, name: product.name } : null,
      [config.partyRelation]: party ? { id: party.id, name: party.name } : null,
      attachments: files.map(toAttachmentDto),
    };
  }

  function detailed(branchId: string, manager?: EntityManager) {
    return base
      .query(branchId, manager)
      .leftJoinAndSelect('d.product', 'product')
      .leftJoinAndSelect(`d.${config.partyRelation}`, 'party');
  }

  async function getRecord(branchId: string, id: string, manager?: EntityManager) {
    const record = await detailed(branchId, manager).andWhere('d.id = :id', { id }).getOne();
    if (!record) throw AppError.notFound(config.label);
    return record;
  }

  async function getDto(branchId: string, id: string, manager?: EntityManager) {
    const record = await getRecord(branchId, id, manager);
    const files = await attachmentsFor(branchId, [id], manager);
    return toDto(record, files.get(id));
  }

  async function assertParty(branchId: string, partyId: string | null | undefined, manager: EntityManager) {
    if (partyId) await suppliersService.requireOfType(branchId, partyId, config.partyType, manager);
  }

  async function saveAttachments(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    documentIds: string[],
    uploaded: UploadedFile[],
  ) {
    for (const documentId of documentIds) {
      for (const file of uploaded) {
        await attachments.create(
          branchId,
          actor.userId,
          {
            documentType: config.kind,
            documentId,
            filePath: file.path,
            originalName: file.originalName,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
          },
          manager,
        );
      }
    }
  }

  return {
    async list(branchId: string, query: StockDocumentListQuery) {
      const qb = detailed(branchId);
      if (query.productId) qb.andWhere('d.productId = :productId', { productId: query.productId });
      if (query.partyId) qb.andWhere(`d.${config.partyKey} = :partyId`, { partyId: query.partyId });
      if (query.createdBy) qb.andWhere('d.createdBy = :createdBy', { createdBy: query.createdBy });
      if (query.from) qb.andWhere('d.date >= :from', { from: query.from });
      if (query.to) qb.andWhere('d.date <= :to', { to: query.to });
      if (config.destinationFilter && query.destination) {
        qb.andWhere('d.destination = :destination', { destination: query.destination });
      }
      const { items, meta } = await paginate(qb, query, {
        searchColumns: ['d.note', 'product.name', 'party.name', 'd.qty'],
        sortMap: { date: 'd.date', createdAt: 'd.createdAt' },
      });
      const files = await attachmentsFor(
        branchId,
        items.map((i) => i.id),
      );
      return { items: items.map((i) => toDto(i, files.get(i.id))), meta };
    },

    get: getDto,

    async create(actor: Actor, branchId: string, input: CreateInput, files: Express.Multer.File[] = []) {
      const uploaded = await uploadAll(branchId, config.kind, files);
      try {
        return await withTransaction(async (em) => {
          const partyId = input[config.partyKey] ?? null;
          await assertParty(branchId, partyId, em);
          const ids: string[] = [];
          for (const item of input.items) {
            const record = await base.create(
              branchId,
              actor.userId,
              {
                ...item,
                [config.partyKey]: partyId,
                date: input.date,
                note: input.note ?? null,
              } as unknown as Partial<T>,
              em,
            );
            await stockLedger.apply(em, ledgerRef(actor, record), [movementFor(record)]);
            ids.push(record.id);
          }
          await saveAttachments(em, actor, branchId, ids, uploaded);
          const created = await Promise.all(ids.map((id) => getDto(branchId, id, em)));
          for (const dto of created) {
            await auditService.record(
              {
                actor,
                branchId,
                action: 'create',
                entity: config.kind,
                entityId: dto.id as string,
                after: dto,
              },
              em,
            );
          }
          return created;
        });
      } catch (err) {
        await discardUploads(uploaded);
        throw err;
      }
    },

    async update(actor: Actor, branchId: string, id: string, input: UpdateInput) {
      return withTransaction(async (em) => {
        const record = await getRecord(branchId, id, em);
        if (config.partyKey in input)
          await assertParty(branchId, input[config.partyKey] as string | null, em);
        const before = await getDto(branchId, id, em);
        Object.assign(record, input, { updatedBy: actor.userId });
        delete record.product;
        delete (record as unknown as Record<string, unknown>)[config.partyRelation];
        const saved = await base.save(record, em);
        await stockLedger.replace(em, ledgerRef(actor, saved), [movementFor(saved)]);
        const after = await getDto(branchId, id, em);
        await auditService.record(
          { actor, branchId, action: 'update', entity: config.kind, entityId: id, before, after },
          em,
        );
        return after;
      });
    },

    async remove(actor: Actor, branchId: string, id: string) {
      await withTransaction(async (em) => {
        const before = await getDto(branchId, id, em);
        const record = await getRecord(branchId, id, em);
        await stockLedger.reverse(em, ledgerRef(actor, record), `${config.label} removed`);
        await base.softDelete(record, actor.userId, em);
        await auditService.record(
          { actor, branchId, action: 'delete', entity: config.kind, entityId: id, before },
          em,
        );
      });
    },

    async addAttachments(actor: Actor, branchId: string, id: string, files: Express.Multer.File[]) {
      if (files.length === 0) throw AppError.badRequest('Attach at least one file');
      await getRecord(branchId, id);
      const uploaded = await uploadAll(branchId, config.kind, files);
      try {
        return await withTransaction(async (em) => {
          await saveAttachments(em, actor, branchId, [id], uploaded);
          return getDto(branchId, id, em);
        });
      } catch (err) {
        await discardUploads(uploaded);
        throw err;
      }
    },

    async attachmentUrl(branchId: string, id: string, attachmentId: string) {
      await getRecord(branchId, id);
      const attachment = await attachments.findOneBy(branchId, {
        id: attachmentId,
        documentType: config.kind,
        documentId: id,
      });
      if (!attachment) throw AppError.notFound('Attachment');
      return createSignedUrl(BUCKETS.stockFiles, attachment.filePath);
    },

    async removeAttachment(actor: Actor, branchId: string, id: string, attachmentId: string) {
      await withTransaction(async (em) => {
        await getRecord(branchId, id, em);
        const attachment = await attachments.findOneBy(
          branchId,
          { id: attachmentId, documentType: config.kind, documentId: id },
          em,
        );
        if (!attachment) throw AppError.notFound('Attachment');
        await attachments.softDelete(attachment, actor.userId, em);
        await auditService.record(
          {
            actor,
            branchId,
            action: 'remove_attachment',
            entity: config.kind,
            entityId: id,
            before: toAttachmentDto(attachment),
          },
          em,
        );
      });
    },
  };
}
