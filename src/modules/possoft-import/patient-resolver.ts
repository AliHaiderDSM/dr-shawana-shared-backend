import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { normalizePhone } from '../patients/phone';
import type { DumpRow } from './dump-reader';
import { byId, text, timestampOf } from './possoft-values';

export class PatientResolver {
  private byLast9 = new Map<string, string>();
  private byNormalized = new Map<string, string>();
  private byCustId = new Map<string, string>();
  private customers: Map<string, DumpRow>;
  created = 0;

  private constructor(customers: Map<string, DumpRow>) {
    this.customers = customers;
  }

  static async load(em: EntityManager, customers: DumpRow[]): Promise<PatientResolver> {
    const resolver = new PatientResolver(byId(customers, 'cust_id'));
    const rows = (await em.query(
      `SELECT id, phone_last9 AS last9, phone_normalized AS normalized FROM patients WHERE deleted_at IS NULL`,
    )) as { id: string; last9: string; normalized: string }[];
    for (const row of rows) {
      if (row.last9) resolver.byLast9.set(row.last9, row.id);
      if (row.normalized) resolver.byNormalized.set(row.normalized, row.id);
    }
    return resolver;
  }

  async resolve(
    em: EntityManager,
    custId: string,
    fallbackCity: string,
    defaultBranchId: string,
  ): Promise<string> {
    const cached = this.byCustId.get(custId);
    if (cached) return cached;
    const customer = this.customers.get(custId);
    const rawPhone = text(customer?.cust_phone);
    const phone = normalizePhone(rawPhone);
    const normalizedKey = `possoft-${custId}`.slice(0, 20);
    const existing = (phone && this.byLast9.get(phone.last9)) ?? this.byNormalized.get(normalizedKey) ?? null;
    if (existing) {
      this.byCustId.set(custId, existing);
      return existing;
    }
    const id = randomUUID();
    const age = Number(text(customer?.cust_age).replace(/\D/g, ''));
    const city = (text(customer?.cust_city) || fallbackCity).slice(0, 100);
    await em.query(
      `INSERT INTO patients (id, name, phone, phone_normalized, phone_last9, city, age, country, address, created_in_branch_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        text(customer?.cust_name).slice(0, 150) || `posSoft customer ${custId}`,
        (rawPhone || 'not given').slice(0, 30),
        phone?.normalized ?? normalizedKey,
        phone?.last9 ?? `P${custId.padStart(8, '0').slice(-8)}`,
        city,
        Number.isInteger(age) && age > 0 && age <= 150 ? age : null,
        text(customer?.cust_country).slice(0, 100) || null,
        text(customer?.cust_address) || null,
        defaultBranchId,
        timestampOf(customer?.crt_date) ?? new Date().toISOString(),
      ],
    );
    this.byCustId.set(custId, id);
    if (phone) this.byLast9.set(phone.last9, id);
    this.byNormalized.set(normalizedKey, id);
    this.created += 1;
    return id;
  }
}
