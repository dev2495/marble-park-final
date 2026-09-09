import { Args, Context, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    const user = await requireSession(this.prisma, ctx);
    return this.notificationsService.forUser(user, { unreadOnly: Boolean(unreadOnly), take });
  }

  @Query(() => GraphQLJSON)
  async notificationInbox(@Context() ctx: GraphqlRequestContext,
    @Args('view', { nullable: true }) view?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('unreadOnly', { nullable: true }) unreadOnly?: boolean,
    @Args('take', { type: () => Int, nullable: true }) take?: number) {
    return this.notificationsService.inbox(await requireSession(this.prisma, ctx), { view, search, cursor, unreadOnly, take });
  }

  @Mutation(() => GraphQLJSON)
  async updateNotifications(@Args('ids', { type: () => [ID] }) ids: string[], @Args('action') action: string, @Context() ctx: GraphqlRequestContext) {
    return this.notificationsService.change(ids, action, await requireSession(this.prisma, ctx));
  }

  @Mutation(() => GraphQLJSON)
  async updateNotificationPreferences(@Args('muteUpdates') muteUpdates: boolean, @Context() ctx: GraphqlRequestContext) {
    return this.notificationsService.preferences(await requireSession(this.prisma, ctx), muteUpdates);
  }

  @Query(() => GraphQLJSON)
  async notificationDeliveryHealth(@Context() ctx: GraphqlRequestContext) {
    return this.notificationsService.health(await requireSession(this.prisma, ctx));
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
