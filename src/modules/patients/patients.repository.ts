import { Brackets, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { repo } from '../../database/transaction';
import { escapeLike, paginate } from '../../lib/pagination';
import { Patient } from './patient.entity';
import { digitsOf, last9Of } from './phone';
import { type PatientListQuery } from './patients.schemas';

const patients = (manager?: EntityManager) => repo(Patient, manager);

function applySearch(qb: SelectQueryBuilder<Patient>, search: string) {
  const term = `%${escapeLike(search)}%`;
  const digits = digitsOf(search);
  const last9 = last9Of(search);
  qb.andWhere(
    new Brackets((w) => {
      w.where('p.name ILIKE :term', { term })
        .orWhere('p.phone ILIKE :term', { term })
        .orWhere('p.city ILIKE :term', { term });
      if (digits.length >= 4) w.orWhere('p.phoneNormalized LIKE :digits', { digits: `%${digits}%` });
      if (last9) w.orWhere('p.phoneLast9 = :last9', { last9 });
    }),
  );
}

function linkedToBranch(qb: SelectQueryBuilder<Patient>, branchId: string) {
  qb.andWhere(
    new Brackets((w) => {
      w.where('p.createdInBranchId = :branchId', { branchId }).orWhere(
        `EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.branch_id = :branchId AND a.deleted_at IS NULL)`,
        { branchId },
      );
    }),
  );
}

export const patientsRepository = {
  findById(id: string, manager?: EntityManager) {
    return patients(manager).findOne({ where: { id } });
  },

  findByLast9(last9: string, manager?: EntityManager) {
    return patients(manager).findOne({ where: { phoneLast9: last9 }, relations: { createdInBranch: true } });
  },

  create(data: Partial<Patient>, manager?: EntityManager) {
    const repository = patients(manager);
    return repository.save(repository.create(data));
  },

  save(patient: Patient, manager?: EntityManager) {
    return patients(manager).save(patient);
  },

  async softDelete(patient: Patient, actorId: string, manager?: EntityManager) {
    const repository = patients(manager);
    await repository.update({ id: patient.id }, { deletedBy: actorId });
    await repository.softDelete({ id: patient.id });
  },

  list(branchId: string, query: PatientListQuery) {
    const qb = patients().createQueryBuilder('p');
    if (query.search) applySearch(qb, query.search);
    else linkedToBranch(qb, branchId);
    if (query.city) qb.andWhere('p.city ILIKE :city', { city: escapeLike(query.city) });
    if (query.bhrtStatus) qb.andWhere('p.bhrtStatus = :bhrt', { bhrt: query.bhrtStatus });
    return paginate(
      qb,
      { ...query, search: undefined },
      { sortMap: { createdAt: 'p.createdAt', name: 'p.name', city: 'p.city' } },
    );
  },

  options(branchId: string, search?: string) {
    const qb = patients()
      .createQueryBuilder('p')
      .select(['p.id', 'p.name', 'p.phone', 'p.city'])
      .orderBy('p.name', 'ASC')
      .take(50);
    if (search) applySearch(qb, search);
    else linkedToBranch(qb, branchId);
    return qb.getMany();
  },

  async cities(search: string): Promise<string[]> {
    const rows = await patients()
      .createQueryBuilder('p')
      .select('MIN(p.city)', 'city')
      .where('p.city ILIKE :term', { term: `%${escapeLike(search)}%` })
      .groupBy('lower(p.city)')
      .orderBy('MIN(p.city)', 'ASC')
      .limit(20)
      .getRawMany<{ city: string }>();
    return rows.map((r) => r.city);
  },
};
