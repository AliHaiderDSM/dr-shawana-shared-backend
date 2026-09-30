import { Column, Entity, Index } from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';

export const STOCK_DOCUMENT_TYPES = ['stock_in', 'stock_out'] as const;
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

@Entity('stock_attachments')
@Index(['documentType', 'documentId'])
export class StockAttachment extends BranchScopedEntity {
  @Column({
    name: 'document_type',
    type: 'enum',
    enum: STOCK_DOCUMENT_TYPES,
    enumName: 'stock_document_type',
  })
  documentType: StockDocumentType;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'file_path', type: 'text' })
  filePath: string;

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 100 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;
}
