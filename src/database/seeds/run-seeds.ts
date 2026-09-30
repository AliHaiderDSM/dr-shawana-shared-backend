import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { companyInfo, lahoreHeadOffice, prescriptionCatalog, type Seed } from './development.seeds';

const seeds: Seed[] = [companyInfo, lahoreHeadOffice, prescriptionCatalog];

async function main() {
  await AppDataSource.initialize();
  try {
    for (const seed of seeds) {
      console.log(`Running seed: ${seed.name}`);
      await AppDataSource.transaction((em) => seed.run(em));
    }
    console.log('Seeding finished.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
