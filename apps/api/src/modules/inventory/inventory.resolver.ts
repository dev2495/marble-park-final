import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context } from '@nestjs/graphql';
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
}

@Resolver()
export class InventoryResolver {
  constructor(
    private inventory: InventoryService,
    private prisma: PrismaService,
  ) {}

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
