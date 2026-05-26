import { Args, Context, Field, Float, ID, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { TargetsService } from './targets.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';

@ObjectType()
export class SalesTargetOutput {
  @Field(() => ID) id!: string;
  @Field() userId!: string;
  @Field() month!: string;
  @Field(() => Float) amount!: number;
  @Field({ nullable: true }) notes?: string;
  @Field() setBy!: string;
  @Field() createdAt!: Date;
}

@InputType()
export class SetTargetInputDto {
  @Field() userId!: string;
  @Field() month!: string;
  @Field(() => Float) amount!: number;
  @Field({ nullable: true }) notes?: string;
}

@Resolver()
export class TargetsResolver {
  constructor(private targets: TargetsService, private prisma: PrismaService) {}

  @Mutation(() => SalesTargetOutput)
  async setSalesTarget(@Args('input') input: SetTargetInputDto, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager']);
    return this.targets.upsert(input.userId, input.month, input.amount, user.id, input.notes);
  }

  @Query(() => [SalesTargetOutput], { name: 'salesTargetsForUser' })
  async salesTargetsForUser(@Args('userId') userId: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.targets.listForUser(userId);
  }

  @Query(() => [SalesTargetOutput], { name: 'salesTargetsForMonth' })
  async salesTargetsForMonth(@Args('month') month: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager']);
    return this.targets.listForMonth(month);
  }

  @Query(() => GraphQLJSON, { name: 'mySalesTargetProgress' })
  async mySalesTargetProgress(@Context() ctx: GraphqlRequestContext, @Args('month', { nullable: true }) month?: string) {
    const user = await requireSession(this.prisma, ctx);
    return this.targets.progress(user.id, month);
  }

  @Query(() => GraphQLJSON, { name: 'salesTargetProgress' })
  async salesTargetProgress(
    @Args('userId') userId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('month', { nullable: true }) month?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager']);
    return this.targets.progress(userId, month);
  }
}
