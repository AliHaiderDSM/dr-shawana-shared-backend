import { type Decimal } from 'decimal.js';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BranchScopedEntity } from '../../database/branch-scoped.entity';
import { quantityColumn } from '../../database/transformers';
import { Product } from '../products/product.entity';
import { Material } from './material.entity';

@Entity('product_recipes')
export class ProductRecipe extends BranchScopedEntity {
  @Index()
  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @OneToMany(() => RecipeItem, (item) => item.recipe)
  items?: RecipeItem[];
}

@Entity('recipe_items')
@Index('UQ_recipe_items_recipe_material', ['recipeId', 'materialId'], { unique: true })
@Check('CHK_recipe_items_qty', `"qty" IS NULL OR "qty" > 0`)
export class RecipeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'recipe_id', type: 'uuid' })
  recipeId: string;

  @ManyToOne(() => ProductRecipe, (recipe) => recipe.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipe_id' })
  recipe?: ProductRecipe;

  @Index()
  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @ManyToOne(() => Material, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'material_id' })
  material?: Material;

  @Column(quantityColumn({ nullable: true }))
  qty: Decimal | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
