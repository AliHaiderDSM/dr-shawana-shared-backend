import { type EntityManager } from 'typeorm';
import { repo } from '../../database/transaction';
import { CompanyInfo } from './company-info.entity';

export const companyRepository = {
  findCurrent(manager?: EntityManager) {
    return repo(CompanyInfo, manager).findOne({ where: {}, order: { createdAt: 'ASC' } });
  },

  save(data: Partial<CompanyInfo>, manager?: EntityManager) {
    const company = repo(CompanyInfo, manager);
    return company.save(company.create(data));
  },
};
