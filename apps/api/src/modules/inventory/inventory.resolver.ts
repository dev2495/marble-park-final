import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context, ResolveField, Parent } from '@nestjs/graphql';
import { InventoryService } from './inventory.service';
import { ProductOutput } from '../products/products.resolver';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@InputType()
export class CreateInventoryInput {
  @Field(() => String)
  productId!: string;

  @Field(() => Number, { nullable: true })
  onHand?: number;
}

@ObjectType()
export class InventoryOutput {
  @Field()
  id!: string;

  @Field()
  productId!: string;

  @Field(() => Number)
  onHand!: number;

  @Field(() => Number)
  available!: number;

  @Field(() => Number)
  reserved!: number;

  @Field(() => Number)
  damaged!: number;

  @Field(() => Number, { defaultValue: 5 })
  lowStockThreshold!: number;

  @Field(() => Number, { nullable: true })
  reorderPoint?: number | null;

  @Field(() => Boolean, { description: 'True when available <= lowStockThreshold (or reorderPoint when set).' })
  isLowStock!: boolean;

  @Field(() => ProductOutput, { nullable: true })
  product?: any;

  @Field()
  updatedAt!: Date;
}

@InputType()
export class UpdateInventoryInput {
  @Field(() => Number, { nullable: true })
  onHand?: number;

  @Field(() => Number, { nullable: true })
  reserved?: number;

  @Field(() => Number, { nullable: true })
  damaged?: number;

  @Field(() => Number, { nullable: true, description: 'Below or equal => low-stock alert. 0 disables.' })
  lowStockThreshold?: number;

  @Field(() => Number, { nullable: true, description: 'Hard reorder point (overrides lowStockThreshold for purchasing).' })
  reorderPoint?: number;
}

@Resolver(() => InventoryOutput)
export class InventoryResolver {
  constructor(
    private inventory: InventoryService,
    private prisma: PrismaService,
  ) {}

  /**
   * Computed flag for the low-stock dashboard. Logic:
   *   - reorderPoint set & available <= reorderPoint -> true
   *   - else lowStockThreshold > 0 & available <= lowStockThreshold -> true
   * Resolved at the field level so callers can query it without an extra
   * round-trip and the threshold field is always returned alongside.
   */
  @ResolveField('isLowStock', () => Boolean)
  resolveIsLowStock(@Parent() balance: any): boolean {
    const available = Number(balance?.available || 0);
    const reorder = balance?.reorderPoint;
    if (reorder !== undefined && reorder !== null && Number(reorder) >= 0) {
      return available <= Number(reorder);
    }
    const threshold = Number(balance?.lowStockThreshold ?? 5);
    if (threshold <= 0) return false;
    return available <= threshold;
  }

  @Query(() => [InventoryOutput])
  async inventoryBalances(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.inventory.findAll({ productId, search, take });
  }

  /**
   * Low-stock list for the inventory dashboard / purchasing alerts.
   * Returns balances where available <= COALESCE(reorderPoint, lowStockThreshold)
   * and the threshold is positive.
   */
  @Query(() => [InventoryOutput])
  async lowStockBalances(
    @Context() ctx: GraphqlRequestContext,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.inventory.findLowStock(take || 100);
  }

  @Query(() => InventoryOutput)
  async inventoryBalance(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.inventory.findById(id);
  }

  @Mutation(() => InventoryOutput)
  async createInventory(@Args('input') input: CreateInventoryInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.inventory.create(input as any);
  }

  @Mutation(() => InventoryOutput)
  async updateInventory(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInventoryInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.inventory.update(id, input as any);
  }

  @Mutation(() => InventoryOutput)
  async adjustInventory(
    @Args('id', { type: () => ID }) id: string,
    @Args('adjustment') adjustment: number,
    @Args('type') type: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('notes', { nullable: true }) notes?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.inventory.adjustQuantity(id, adjustment, type as any, notes, user.id);
  }
}
