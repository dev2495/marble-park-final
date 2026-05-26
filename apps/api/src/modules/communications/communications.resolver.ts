import { Args, Context, Field, ID, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { CommunicationsService } from './communications.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@ObjectType()
export class CommunicationOutput {
  @Field(() => ID) id!: string;
  @Field({ nullable: true }) customerId?: string;
  @Field({ nullable: true }) leadId?: string;
  @Field() type!: string;
  @Field() direction!: string;
  @Field() summary!: string;
  @Field({ nullable: true }) body?: string;
  @Field() recordedBy!: string;
  @Field() occurredAt!: Date;
  @Field() createdAt!: Date;
  @Field(() => GraphQLJSON, { nullable: true }) attachments?: any;
}

@InputType()
export class CreateCommunicationInputDto {
  @Field({ nullable: true }) customerId?: string;
  @Field({ nullable: true }) leadId?: string;
  @Field() type!: string;
  @Field({ nullable: true }) direction?: string;
  @Field() summary!: string;
  @Field({ nullable: true }) body?: string;
  @Field({ nullable: true }) occurredAt?: Date;
  @Field(() => GraphQLJSON, { nullable: true }) attachments?: any;
}

@Resolver()
export class CommunicationsResolver {
  constructor(private comms: CommunicationsService, private prisma: PrismaService) {}

  @Mutation(() => CommunicationOutput)
  async logCommunication(@Args('input') input: CreateCommunicationInputDto, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.comms.create(input as any, user.id);
  }

  @Mutation(() => Boolean)
  async deleteCommunication(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager']);
    await this.comms.remove(id, user.id);
    return true;
  }

  @Query(() => [CommunicationOutput], { name: 'communicationsForCustomer' })
  async communicationsForCustomer(@Args('customerId') customerId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff', 'inventory_manager', 'dispatch_ops']);
    return this.comms.listForCustomer(customerId);
  }

  @Query(() => [CommunicationOutput], { name: 'communicationsForLead' })
  async communicationsForLead(@Args('leadId') leadId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.comms.listForLead(leadId);
  }
}
