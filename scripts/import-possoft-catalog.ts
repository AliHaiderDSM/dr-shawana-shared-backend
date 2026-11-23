import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { AppDataSource } from '../src/database/data-source';
import { readDump } from '../src/modules/possoft-import/dump-reader';
import {
  POSSOFT_CATALOG_TABLES,
  importPossoftCatalog,
  linkBranchProductsToWarehouse,
} from '../src/modules/possoft-import/import-catalog';

class DryRunRollback extends Error {}

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const file = argument('file');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !existsSync(file))
    throw new Error('Pass the posSoft data export: --file /path/to/pos_dsm.sql');

  const dump = await readDump(file, POSSOFT_CATALOG_TABLES);
  for (const table of POSSOFT_CATALOG_TABLES)
    console.log(`Read ${table}: ${dump.get(table)?.length ?? 0} rows`);

  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (em) => {
      const catalog = await importPossoftCatalog(em, dump);
      const linked = await linkBranchProductsToWarehouse(em, catalog.warehouseId);
      console.log(
        JSON.stringify(
          {
            categoriesAdded: catalog.categoriesAdded,
            productsAdded: catalog.productsAdded,
            productsAlreadyThere: catalog.productsReused,
            branchProductsLinked: linked,
          },
          null,
          2,
        ),
      );
      if (dryRun) throw new DryRunRollback();
    });
    console.log('Catalog saved in the main warehouse.');
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
    console.log('Dry run: nothing was saved.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('Catalog import failed:', err);
  process.exit(1);
});
