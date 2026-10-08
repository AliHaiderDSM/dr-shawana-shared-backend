import { repo } from '../../database/transaction';
import { AppError } from '../../lib/errors';
import { today } from '../../lib/validation';
import { Branch } from '../branches/branch.entity';
import { companyService } from '../company/company.service';
import { Patient } from '../patients/patient.entity';
import { Sale } from './sale.entity';
import { salesService, toSalePaymentDto } from './sales.service';
import { type DeliverySlipsQuery } from './sales.schemas';

async function header(branchId: string) {
  const [company, branch] = await Promise.all([
    companyService.get().catch(() => null),
    repo(Branch).findOneBy({ id: branchId }),
  ]);
  if (!branch) throw AppError.notFound('Branch');
  return {
    company: company
      ? {
          name: company.name,
          phone: company.phone,
          email: company.email,
          address: company.address,
          logoPath: company.logoPath,
        }
      : null,
    branch: {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      city: branch.city,
      address: branch.address,
      phone: branch.phone,
    },
  };
}

export const saleDocumentsService = {
  async bill(branchId: string, id: string) {
    const sale = await salesService.getRecord(branchId, id);
    const patient = await repo(Patient).findOneBy({ id: sale.patientId });
    const dto = salesService.toDto(sale);
    const payments = (sale.payments ?? []).map(toSalePaymentDto);
    return {
      ...(await header(branchId)),
      customer: patient
        ? { name: patient.name, phone: patient.phone, address: patient.address, city: patient.city }
        : null,
      sale: {
        invoiceNo: dto.invoiceNo,
        date: dto.date,
        saleType: dto.saleType,
        city: dto.city,
        totalQty: dto.totalQty,
        subtotal: dto.subtotal,
        discountPercent: dto.discountPercent,
        discountAmount: dto.discountAmount,
        total: dto.total,
        received: dto.received,
        remaining: dto.remaining,
        paymentStatus: dto.paymentStatus,
        note: dto.note,
      },
      items: dto.items.map((i, index) => ({
        sr: index + 1,
        product: i.product?.name ?? '',
        bundle: i.bundle?.name ?? null,
        qty: i.qty,
        unitPrice: i.unitPrice,
        discountPercent: i.discountPercent,
        discountAmount: i.discountAmount,
        lineTotal: i.lineTotal,
      })),
      payments: {
        cash: payments.filter((p) => p.method === 'cash'),
        online: payments.filter((p) => p.method === 'online'),
      },
    };
  },

  async deliverySlips(branchId: string, query: DeliverySlipsQuery) {
    const from = query.from ?? (query.invoiceFrom || query.invoiceTo ? undefined : today());
    const to = query.to ?? from;
    const qb = repo(Sale)
      .createQueryBuilder('sale')
      .leftJoinAndSelect('sale.patient', 'patient')
      .leftJoinAndSelect('sale.items', 'item', 'item.deletedAt IS NULL')
      .leftJoinAndSelect('item.product', 'product')
      .where('sale.branchId = :branchId', { branchId })
      .andWhere("(sale.deliveryStatus IS NULL OR sale.deliveryStatus <> 'cancelled')");
    if (query.patientId) qb.andWhere('sale.patientId = :patientId', { patientId: query.patientId });
    if (query.saleType) qb.andWhere('sale.saleType = :saleType', { saleType: query.saleType });
    const dateColumn = query.dateBy === 'dispatched' ? 'sale.dispatchedOn' : 'sale.date';
    if (from) qb.andWhere(`${dateColumn} >= :from`, { from });
    if (to) qb.andWhere(`${dateColumn} <= :to`, { to });
    if (query.invoiceFrom) qb.andWhere('sale.invoiceSeq >= :invoiceFrom', { invoiceFrom: query.invoiceFrom });
    if (query.invoiceTo) qb.andWhere('sale.invoiceSeq <= :invoiceTo', { invoiceTo: query.invoiceTo });
    const rows = await qb.orderBy('sale.invoiceSeq', 'DESC').getMany();
    const { company, branch } = await header(branchId);
    const sender = {
      name: company?.name ?? branch.name,
      phone: branch.phone ?? company?.phone ?? null,
      city: branch.city,
      address: branch.address ?? company?.address ?? null,
    };
    return {
      logoPath: company?.logoPath ?? null,
      slipsPerPage: 2,
      slips: rows.map((sale) => ({
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        date: sale.date,
        saleType: sale.saleType,
        to: {
          name: sale.patient?.name ?? '',
          phone: sale.patient?.phone ?? '',
          city: sale.patient?.city ?? sale.patientCity,
          address: sale.patient?.address ?? null,
        },
        items: (sale.items ?? []).map((i) => ({
          productId: i.productId,
          name: i.product?.name ?? '',
          qty: i.qty,
        })),
        from: sender,
      })),
    };
  },
};
