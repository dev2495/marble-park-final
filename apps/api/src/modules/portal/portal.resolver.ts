import { Args, Context, Field, ID, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { PortalService } from './portal.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@ObjectType()
export class PortalTokenOutput {
  @Field() token!: string;
  @Field() expiresAt!: Date;
}

@ObjectType()
export class PortalTokenSummary {
  @Field(() => ID) id!: string;
  @Field() customerId!: string;
  @Field() expiresAt!: Date;
  @Field({ nullable: true }) revokedAt?: Date;
  @Field() createdAt!: Date;
}

@Resolver()
export class PortalResolver {
  constructor(private portal: PortalService, private prisma: PrismaService) {}

  @Mutation(() => PortalTokenOutput)
  async issuePortalLink(
    @Args('customerId') customerId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('ttlDays', { type: () => Int, nullable: true }) ttlDays?: number,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.portal.issueToken(customerId, user.id, ttlDays || 30);
  }

  @Mutation(() => Boolean)
  async revokePortalToken(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager']);
    await this.portal.revoke(id, user.id);
    return true;
  }

  @Query(() => [PortalTokenSummary], { name: 'portalTokens' })
  async portalTokens(@Args('customerId') customerId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.portal.listForCustomer(customerId);
  }

  // Public query — no session required, the token IS the auth.
  @Query(() => GraphQLJSON, { name: 'portalSnapshot' })
  async portalSnapshot(@Args('token') token: string) {
    return this.portal.snapshot(token);
  }
}
