import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  type CopyObjectCommandInput,
} from '@aws-sdk/client-s3';
import { createBranch } from '../../tests/helpers/fixtures';
import { AppDataSource } from '../database/data-source';
import { branchCodePath, chatCodePath, moveToBranchFolders } from './branch-folder-move';
import { setR2ClientForTests } from './r2';

function fakeR2(keys: string[]) {
  const objects = new Set(keys);
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  jest.spyOn(client, 'send').mockImplementation(async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      if (!objects.has(command.input.Key ?? '')) throw new Error('NotFound');
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      const input = command.input as CopyObjectCommandInput;
      objects.add(input.Key ?? '');
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key ?? '');
      return {};
    }
    throw new Error('unexpected command');
  });
  return { client, objects };
}

describe('moving old files into branch code folders', () => {
  afterEach(() => setR2ClientForTests(undefined));

  it('builds branch code paths', () => {
    const codes = new Map([['de3c8514-de99-4185-90b1-af2600f14aba', 'LHR']]);
    expect(branchCodePath('de3c8514-de99-4185-90b1-af2600f14aba/medical-records/a.pdf', codes)).toBe(
      'LHR/medical-records/a.pdf',
    );
    expect(branchCodePath('de3c8514-de99-4185-90b1-af2600f14aba/p1/a.png', codes, 'products')).toBe(
      'LHR/products/p1/a.png',
    );
    expect(branchCodePath('LHR/medical-records/a.pdf', codes)).toBeNull();
    expect(chatCodePath('voice/c1/a.m4a', 'LHR')).toEqual({ bucket: 'chat-voice', path: 'LHR/c1/a.m4a' });
    expect(chatCodePath('chat/c1/a.jpg', 'LHR')).toEqual({
      bucket: 'medical-records',
      path: 'LHR/chat/c1/a.jpg',
    });
  });

  it('copies the file, updates the stored path and keeps or deletes the old copy', async () => {
    const branch = await createBranch({ code: 'LHR' });
    const oldPath = `${branch.id}/categories/c1/a.png`;
    const lostPath = `${branch.id}/categories/c2/b.png`;
    const [kept] = (await AppDataSource.query(
      `INSERT INTO categories (branch_id, name, image_path) VALUES ($1, 'Soap', $2), ($1, 'Lost', $3) RETURNING id`,
      [branch.id, oldPath, lostPath],
    )) as { id: string }[];
    const r2 = fakeR2([`product-images/${oldPath}`]);
    setR2ClientForTests(r2.client);

    const first = await moveToBranchFolders(AppDataSource, false);
    expect(first['categories.image_path']).toEqual({ moved: 1, missing: 1 });
    expect(r2.objects.has('product-images/LHR/categories/c1/a.png')).toBe(true);
    expect(r2.objects.has(`product-images/${oldPath}`)).toBe(true);
    const [row] = (await AppDataSource.query(`SELECT image_path FROM categories WHERE id = $1`, [
      kept?.id,
    ])) as {
      image_path: string;
    }[];
    expect(row?.image_path).toBe('LHR/categories/c1/a.png');

    await AppDataSource.query(`UPDATE categories SET image_path = $1 WHERE id = $2`, [oldPath, kept?.id]);
    const again = await moveToBranchFolders(AppDataSource, true);
    expect(again['categories.image_path']).toEqual({ moved: 1, missing: 1 });
    expect(r2.objects.has(`product-images/${oldPath}`)).toBe(false);
    expect(r2.objects.has('product-images/LHR/categories/c1/a.png')).toBe(true);
  });
});
