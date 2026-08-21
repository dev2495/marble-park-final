import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context, ResolveField, Parent } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { InventoryService } from './inventory.service';
import { ProductOutput } from '../products/products.resolver';
import { GraphqlRequestContext, requirePermission, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { computeStockAlertState, isAlertingState } from './stock-alerts';
import { inventoryCostView } from '../common/cost-visibility';

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

  @Field(() => Number, { nullable: true, description: 'Critical breach level. Null/0 disables.' })
  criticalStockThreshold?: number | null;

  @Field(() => Number, { nullable: true })
  reorderPoint?: number | null;

  @Field(() => String, { description: 'healthy | warning | critical | off' })
  alertState!: string;

  @Field(() => Boolean, { description: 'True when alertState is warning or critical.' })
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

  @Field(() => Number, { nullable: true, description: 'Warning tier. Available <= this (>0) fires stock_warning. 0 disables.' })
  lowStockThreshold?: number;

  @Field(() => Number, { nullable: true, description: 'Critical breach tier. Null/0 disables.' })
  criticalStockThreshold?: number | null;

  @Field(() => Number, { nullable: true, description: 'Hard reorder point (procurement). Not the primary alert threshold.' })
  reorderPoint?: number;
}

@InputType()
export class StockAlertPolicyRowInput {
  @Field(() => ID)
  balanceId!: string;

  @Field(() => Number, { nullable: true })
  lowStockThreshold?: number;

  @Field(() => Number, { nullable: true })
  criticalStockThreshold?: number | null;
}

@Resolver(() => InventoryOutput)
export class InventoryResolver {
  constructor(
    private inventory: InventoryService,
    private prisma: PrismaService,
  ) {}

  @ResolveField('alertState', () => String)
  resolveAlertState(@Parent() balance: any): string {
    if (balance?.alertState) return String(balance.alertState);
    return computeStockAlertState(balance?.available, balance?.lowStockThreshold, balance?.criticalStockThreshold);
  }

  /**
   * Computed flag for the low-stock dashboard.
   * True when warning or critical (two-tier alert policy).
   */
  @ResolveField('isLowStock', () => Boolean)
  resolveIsLowStock(@Parent() balance: any): boolean {
    const state = balance?.alertState
      || computeStockAlertState(balance?.available, balance?.lowStockThreshold, balance?.criticalStockThreshold);
    return isAlertingState(state as any);
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

  @Query(() => GraphQLJSON)
  async inventoryControlTower(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('brand', { nullable: true }) brand?: string,
    @Args('stockState', { nullable: true }) stockState?: string,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('lotState', { nullable: true }) lotState?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    const user = await requireSession(this.prisma, ctx);
    return inventoryCostView(await this.inventory.controlTower({ search, category, brand, stockState, locationId, lotState, sort, cursor, take }), user);
  }

  /**
   * Low-stock list for the inventory dashboard / purchasing alerts.
   * Returns balances in warning or critical alert state.
   */
  @Query(() => [InventoryOutput])
  async lowStockBalances(
    @Context() ctx: GraphqlRequestContext,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.inventory.findLowStock(take || 100);
  }

  @Query(() => GraphQLJSON)
  async stockAlertPolicies(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('brand', { nullable: true }) brand?: string,
    @Args('alertState', { nullable: true }) alertState?: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.inventory.stockAlertPolicies({ search, category, brand, alertState, cursor, take });
  }

  @Query(() => [GraphQLJSON])
  async pendingInwardItems(
    @Context() ctx: GraphqlRequestContext,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.inventory.pendingInwardItems(take || 200);
  }

  @Query(() => InventoryOutput)
  async inventoryBalance(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.inventory.findById(id);
  }

  @Mutation(() => InventoryOutput)
  async createInventory(@Args('input') input: CreateInventoryInput, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.inventory.create(input as any);
  }

  @Mutation(() => InventoryOutput)
  async updateInventory(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInventoryInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const thresholdTouched = input.lowStockThreshold !== undefined || input.criticalStockThreshold !== undefined;
    const user = thresholdTouched
      ? await requireRoles(this.prisma, ctx, ['admin', 'owner'])
      : await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.inventory.update(id, input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async bulkUpdateStockAlertPolicies(
    @Args('input', { type: () => [StockAlertPolicyRowInput] }) input: StockAlertPolicyRowInput[],
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.inventory.bulkUpdateStockAlertPolicies(input as any, user.id);
  }

  @Mutation(() => InventoryOutput)
  async adjustInventory(
    @Args('id', { type: () => ID }) id: string,
    @Args('adjustment') adjustment: number,
    @Args('type') type: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('notes', { nullable: true }) notes?: string,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.inventory.adjustQuantity(id, adjustment, type as any, notes, user.id);
  }
}
