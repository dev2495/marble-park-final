import { Args, Context, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Resolver()
export class NotificationsResolver {
  constructor(private notificationsService: NotificationsService, private prisma: PrismaService) {}

  @Query(() => [GraphQLJSON])
  async notifications(
    @Context() ctx: GraphqlRequestContext,
    @Args('unreadOnly', { nullable: true }) unreadOnly?: boolean,
    @Args('take', { nullable: true }) take?: number,
  ) {
    const user = await requireSession(this.prisma, ctx);
    return this.notificationsService.forUser(user, { unreadOnly: Boolean(unreadOnly), take });
  }

  @Query(() => Number)
  async unreadNotificationCount(@Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.notificationsService.unreadCount(user);
  }

  @Mutation(() => GraphQLJSON)
  async markNotificationRead(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.notificationsService.markRead(id, user);
  }
}
