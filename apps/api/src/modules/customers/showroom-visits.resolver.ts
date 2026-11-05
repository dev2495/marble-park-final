import { Args, Context, Field, ID, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { allowLookup, clientIp } from '../products/public-catalogue.resolver';
import { ShowroomVisitsService } from './showroom-visits.service';

@InputType()
class ShowroomCheckInInput {
  @Field() name!: string;
  @Field() mobile!: string;
  @Field({ nullable: true }) city?: string;
  @Field({ nullable: true }) note?: string;
}

/** Walk-ins: visitors check in from the showroom scan page; staff work them from a list. */
@Resolver()
export class ShowroomVisitsResolver {
  constructor(private visits: ShowroomVisitsService, private prisma: PrismaService) {}

  @Mutation(() => GraphQLJSON)
  publicShowroomCheckIn(@Args('input') input: ShowroomCheckInInput, @Context() ctx: GraphqlRequestContext) {
    if (!allowLookup(clientIp(ctx))) return { error: 'Too many attempts in a minute. Please wait a moment and try again.' };
    return this.visits.checkIn(input);
  }

  @Query(() => GraphQLJSON)
  publicShowroomVisit(@Args('visitToken') visitToken: string) {
    return this.visits.visitSummary(visitToken);
  }

  @Query(() => GraphQLJSON)
  async showroomWalkIns(
    @Context() ctx: GraphqlRequestContext,
    @Args('day', { nullable: true }) day?: string,
    @Args('status', { nullable: true }) status?: string,
  ) {
    await requireSession(this.prisma, ctx);
    return this.visits.list({ day, status });
  }

  @Mutation(() => GraphQLJSON)
  async startWalkInQuote(@Args('visitId', { type: () => ID }) visitId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.visits.startQuote(visitId, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async setWalkInStatus(@Args('visitId', { type: () => ID }) visitId: string, @Args('status') status: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.visits.setStatus(visitId, status, user.id);
  }
}
