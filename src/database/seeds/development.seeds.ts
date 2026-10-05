import { type EntityManager } from 'typeorm';
import { Branch } from '../../modules/branches/branch.entity';
import { CompanyInfo } from '../../modules/company/company-info.entity';
import { catalogService } from '../../modules/prescriptions/prescriptions.service';

export interface Seed {
  name: string;
  run: (manager: EntityManager) => Promise<void>;
}

export const companyInfo: Seed = {
  name: 'Company info from posSoft',
  async run(manager) {
    const company = manager.getRepository(CompanyInfo);
    if ((await company.count({ withDeleted: true })) > 0) return;
    await company.save(
      company.create({
        name: 'Dr Shawana Mufti DSM',
        phone: '03284905049',
        email: 'info@drshawanamufti.com',
        address: '123 E Hali road, Gulberg Lahore, Pakistan',
        logoPath: null,
      }),
    );
  },
};

export const prescriptionCatalog: Seed = {
  name: 'Prescription catalog for every branch',
  async run(manager) {
    for (const branch of await manager.getRepository(Branch).find()) {
      const added = await catalogService.seedBranch(branch.id, manager);
      if (added > 0) console.log(`  ${branch.code}: added ${added} catalog items`);
    }
  },
};
