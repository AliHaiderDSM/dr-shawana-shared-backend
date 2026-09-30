import { withTransaction } from '../../database/transaction';
import { type Actor } from '../../lib/actor';
import { auditService } from '../audit/audit.service';
import { type CompanyInfo } from './company-info.entity';
import { companyRepository } from './company.repository';
import { type UpdateCompanyInfoInput } from './company.schemas';

export function toCompanyDto(company: CompanyInfo) {
  return {
    id: company.id,
    name: company.name,
    phone: company.phone,
    email: company.email,
    address: company.address,
    logoPath: company.logoPath,
    updatedAt: company.updatedAt,
  };
}

export const companyService = {
  async get() {
    const company = await companyRepository.findCurrent();
    return company ? toCompanyDto(company) : null;
  },

  async update(actor: Actor, input: UpdateCompanyInfoInput) {
    return withTransaction(async (em) => {
      const current = await companyRepository.findCurrent(em);
      const saved = await companyRepository.save(
        current ? { ...current, ...input, updatedBy: actor.userId } : { ...input, createdBy: actor.userId },
        em,
      );
      await auditService.record(
        {
          actor,
          branchId: null,
          action: current ? 'update' : 'create',
          entity: 'company_info',
          entityId: saved.id,
          before: current ? toCompanyDto(current) : null,
          after: toCompanyDto(saved),
        },
        em,
      );
      return toCompanyDto(saved);
    });
  },
};
