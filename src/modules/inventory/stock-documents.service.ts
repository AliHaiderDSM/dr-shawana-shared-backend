import Decimal from 'decimal.js';
import { type EntityManager, type EntityTarget } from 'typeorm';
import { AppDataSource } from '../../database/data-source';
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
import { inventoryItemsService, type TakenItem } from './inventory-items.service';
import { transfersService } from './transfers.service';
import { productBatchesService } from './product-batches.service';
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
  batched: boolean;
}

interface CreateInput {
  date: string;
  note?: string | null;
  supplierId?: string | null;
  dispatcherId?: string | null;
  toBranchId?: string | null;
  items: ({
    productId: string;
    qty: string;
    labels?: 'none' | 'generate' | 'existing';
    firstSerial?: string;
    serials?: string[];
  } & Record<string, unknown>)[];
}

interface LabelRange {
  count: number;
  firstSerial: string;
  lastSerial: string;
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
    ...(config.batched
      ? { batchId: (record as StockIn).batchId, unitCost: (record as StockIn).unitCost }
      : {}),
  });

  async function batchFieldsFor(
    manager: EntityManager,
    actor: Actor,
    branchId: string,
    productId: string,
    values: Record<string, unknown>,
    supplierId: string | null,
    overwrite = false,
  ) {
    if (!config.batched) return {};
    const batchNo = typeof values.batch === 'string' ? values.batch.trim() : '';
    const manufacturingDate = (values.manufacturingDate as string | null | undefined) ?? null;
    const expiryDate = (values.expiryDate as string | null | undefined) ?? null;
    const unitCost = (values.unitCost as string | null | undefined) ?? null;
    if (!batchNo) return { batch: null, batchId: null, manufacturingDate, expiryDate, unitCost };
    const batch = await productBatchesService.resolve(
      manager,
      actor,
      branchId,
      productId,
      { batchNo, manufacturingDate, expiryDate, supplierId, unitCost },
      { overwrite },
    );
    return {
      batch: batch.batchNo,
      batchId: batch.id,
      manufacturingDate: batch.manufacturingDate,
      expiryDate: batch.expiryDate,
      unitCost,
    };
  }

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

  async function labelsFor(ids: string[], manager?: EntityManager) {
    const labels = new Map<string, LabelRange>();
    if (ids.length === 0) return labels;
    const key = config.kind === 'stock_in' ? 'source_id' : 'stock_out_id';
    const extra = config.kind === 'stock_in' ? "AND source_type = 'stock_in'" : '';
    const rows: (LabelRange & { id: string })[] = await (manager ?? AppDataSource).query(
      `SELECT ${key} AS id, COUNT(*)::int AS count, MIN(serial) AS "firstSerial", MAX(serial) AS "lastSerial"
         FROM inventory_items WHERE ${key} = ANY($1) ${extra} GROUP BY ${key}`,
      [ids],
    );
    for (const { id, ...range } of rows) labels.set(id, range);
    return labels;
  }

  async function productInfo(manager: EntityManager, branchId: string, productId: string) {
    const [row] = (await manager.query(
      'SELECT name, track_serials AS "trackSerials" FROM products WHERE id = $1 AND branch_id = $2',
      [productId, branchId],
    )) as { name: string; trackSerials: boolean }[];
    if (!row) throw AppError.badRequest('The product was not found in this branch');
    return row;
  }

  function toDto(record: T, files: StockAttachment[] = [], labels: LabelRange | null = null) {
    const plain = withoutInternals(record) as Record<string, unknown>;
    const party = plain[config.partyRelation] as { id: string; name: string } | null | undefined;
    const target = plain.toBranch as { id: string; name: string } | null | undefined;
    const product = record.product;
    const dto: Record<string, unknown> = {
      ...plain,
      product: product ? { id: product.id, name: product.name } : null,
      [config.partyRelation]: party ? { id: party.id, name: party.name } : null,
      attachments: files.map(toAttachmentDto),
      labels,
    };
    if (config.kind === 'stock_out') dto.toBranch = target ? { id: target.id, name: target.name } : null;
    return dto;
  }

  function detailed(branchId: string, manager?: EntityManager) {
    const qb = base
      .query(branchId, manager)
      .leftJoinAndSelect('d.product', 'product')
      .leftJoinAndSelect(`d.${config.partyRelation}`, 'party');
    return config.kind === 'stock_out' ? qb.leftJoinAndSelect('d.toBranch', 'toBranch') : qb;
  }

  async function getRecord(branchId: string, id: string, manager?: EntityManager) {
    const record = await detailed(branchId, manager).andWhere('d.id = :id', { id }).getOne();
    if (!record) throw AppError.notFound(config.label);
    return record;
  }

  async function getDto(branchId: string, id: string, manager?: EntityManager) {
    const record = await getRecord(branchId, id, manager);
    const files = await attachmentsFor(branchId, [id], manager);
    const labels = await labelsFor([id], manager);
    return toDto(record, files.get(id), labels.get(id) ?? null);
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

  async function postPieces(
    manager: EntityManager,
    actor: Actor,
    record: T,
    product: { name: string; trackSerials: boolean },
    pieces: { labels?: string; firstSerial?: string; serials?: string[] },
  ): Promise<TakenItem[]> {
    const ref = ledgerRef(actor, record);
    if (config.kind === 'stock_in') {
      const stockIn = record as StockIn;
      await stockLedger.apply(manager, ref, [movementFor(record)]);
      const mode = pieces.labels ?? 'none';
      if (mode === 'none' && product.trackSerials) {
        throw AppError.unprocessable(
          `${product.name} is tracked by label: print new labels or enter the first label on the packs`,
        );
      }
      if (mode === 'none') return [];
      const common = {
        branchId: record.branchId,
        productId: record.productId,
        batchId: stockIn.batchId,
        qty: record.qty,
        date: record.date,
        source: 'stock_in' as const,
        ref: { type: 'stock_in', id: record.id, label: stockIn.batch },
        event: 'received' as const,
      };
      if (mode === 'generate') await inventoryItemsService.generate(manager, actor, common);
      else
        await inventoryItemsService.register(manager, actor, {
          ...common,
          firstSerial: pieces.firstSerial ?? '',
        });
      return [];
    }
    const serials = pieces.serials ?? [];
    if (!product.trackSerials) {
      if (serials.length > 0) throw AppError.badRequest(`${product.name} is not tracked by label`);
      await stockLedger.apply(manager, ref, [movementFor(record)]);
      return [];
    }
    if (!record.qty.equals(serials.length)) {
      throw AppError.unprocessable(
        `Scan the label of every ${product.name} that goes out (${serials.length} of ${record.qty.toString()} scanned)`,
      );
    }
    const taken = await inventoryItemsService.take(manager, actor, {
      branchId: record.branchId,
      serials,
      from: ['in_stock'],
      to: 'dispatched',
      event: 'dispatched',
      ref: { type: 'stock_out', id: record.id, label: (record as StockOut).destination },
      date: record.date,
      sellableOnly: true,
      productIds: new Set([record.productId]),
    });
    await stockLedger.apply(
      manager,
      ref,
      inventoryItemsService.movements(taken, -1, { type: 'stock_out', date: record.date, note: record.note }),
    );
    return taken;
  }

  function assertNotTransferIn(record: T) {
    if ((record as Partial<StockIn>).transferOutId) {
      throw AppError.conflict(
        'This stock came from the Super Admin stock. Only the Super Admin can cancel the transfer there.',
      );
    }
  }

  async function piecesOf(manager: EntityManager, record: T) {
    if (config.kind === 'stock_in')
      return inventoryItemsService.countFromSource(manager, 'stock_in', record.id);
    const [row] = (await manager.query(
      'SELECT COUNT(*)::int AS n FROM inventory_items WHERE stock_out_id = $1',
      [record.id],
    )) as [{ n: number }];
    return row.n;
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
      const labels = await labelsFor(items.map((i) => i.id));
      return { items: items.map((i) => toDto(i, files.get(i.id), labels.get(i.id) ?? null)), meta };
    },

    get: getDto,

    async create(actor: Actor, branchId: string, input: CreateInput, files: Express.Multer.File[] = []) {
      const uploaded = await uploadAll(branchId, config.kind, files);
      try {
        return await withTransaction(async (em) => {
          const partyId = input[config.partyKey] ?? null;
          await assertParty(branchId, partyId, em);
          if (config.kind === 'stock_in') await transfersService.assertReceivesFromWarehouse(em, branchId);
          else await transfersService.assertSendsFromWarehouse(em, branchId);
          const route =
            config.kind === 'stock_out' && input.toBranchId
              ? await transfersService.assertRoute(em, branchId, input.toBranchId)
              : null;
          const ids: string[] = [];
          for (const item of input.items) {
            const { labels, firstSerial, serials, ...fields } = item;
            const product = await productInfo(em, branchId, item.productId);
            const record = await base.create(
              branchId,
              actor.userId,
              {
                ...fields,
                ...(await batchFieldsFor(em, actor, branchId, item.productId, item, partyId)),
                [config.partyKey]: partyId,
                date: input.date,
                note: input.note ?? null,
                ...(route ? { toBranchId: route.id, destination: route.name } : {}),
              } as unknown as Partial<T>,
              em,
            );
            const taken = await postPieces(em, actor, record, product, { labels, firstSerial, serials });
            if (route) await transfersService.receive(em, actor, record as StockOut, route, taken);
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
        assertNotTransferIn(record);
        if (config.partyKey in input)
          await assertParty(branchId, input[config.partyKey] as string | null, em);
        const before = await getDto(branchId, id, em);
        const transfer = Boolean((record as Partial<StockOut>).toBranchId);
        const pieces = await piecesOf(em, record);
        const previous = {
          productId: record.productId,
          qty: record.qty,
          batch: (record as Partial<StockIn>).batch ?? null,
        };
        Object.assign(record, input, { updatedBy: actor.userId });
        const tracked = await inventoryItemsService.trackedProducts(em, branchId, [
          previous.productId,
          record.productId,
        ]);
        const changed =
          record.productId !== previous.productId ||
          !new Decimal(record.qty).equals(previous.qty) ||
          ((record as Partial<StockIn>).batch ?? null) !== previous.batch;
        if (changed && transfer) {
          throw AppError.conflict(
            'This is a transfer to a branch. Delete it and transfer again to change it.',
          );
        }
        if (changed && (pieces > 0 || tracked.size > 0)) {
          throw AppError.conflict(
            'This entry is for a product tracked by label. Delete it and enter it again to change the product, quantity or batch.',
          );
        }
        if (transfer && 'destination' in input) delete (record as Partial<StockOut>).destination;
        Object.assign(
          record,
          await batchFieldsFor(
            em,
            actor,
            branchId,
            record.productId,
            record as unknown as Record<string, unknown>,
            (record as unknown as Record<string, unknown>)[config.partyKey] as string | null,
            true,
          ),
        );
        delete (record as Partial<StockIn>).productBatch;
        delete record.product;
        delete (record as unknown as Record<string, unknown>)[config.partyRelation];
        const saved = await base.save(record, em);
        if (pieces === 0 && tracked.size === 0 && !transfer) {
          await stockLedger.replace(em, ledgerRef(actor, saved), [movementFor(saved)]);
        }
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
        assertNotTransferIn(record);
        if (config.kind === 'stock_out') await transfersService.undo(em, actor, record as StockOut);
        if (config.kind === 'stock_in') {
          const removed = await inventoryItemsService.removeUntouched(em, branchId, 'stock_in', record.id);
          const tracked = await inventoryItemsService.trackedProducts(em, branchId, [record.productId]);
          if (removed === 0 && tracked.size > 0) {
            const free = await inventoryItemsService.unlabelled(
              em,
              branchId,
              record.productId,
              (record as StockIn).batchId,
            );
            if (free.lt(record.qty)) {
              throw AppError.conflict('Its stock already carries labels. Remove those pieces first.');
            }
          }
        } else {
          await inventoryItemsService.release(em, actor, {
            where: { stockOutId: record.id },
            from: ['dispatched'],
            to: 'in_stock',
            event: 'dispatch_cancelled',
            ref: { type: config.kind, id: record.id, label: `${config.label} removed` },
            clear: ['stockOut'],
          });
        }
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
