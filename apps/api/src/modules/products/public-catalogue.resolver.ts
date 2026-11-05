import { Args, Context, Field, ID, InputType, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { PublicCatalogueService } from './public-catalogue.service';

@InputType()
class CatalogueShareInput {
  @Field(() => [ID]) productIds!: string[];
  @Field({ nullable: true }) title?: string;
  @Field({ nullable: true }) note?: string;
  @Field(() => Int, { nullable: true }) expiresInDays?: number;
}

// The showroom scan page is open to anyone; a small per-IP window keeps it from being scraped.
const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_LIMIT = 60;
const lookupHits = new Map<string, { count: number; resetAt: number }>();

export function clientIp(ctx: GraphqlRequestContext) {
  const req: any = ctx.req || {};
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

export function allowLookup(ip: string) {
  const now = Date.now();
  if (lookupHits.size > 5000) for (const [key, hit] of lookupHits) if (hit.resetAt <= now) lookupHits.delete(key);
  const hit = lookupHits.get(ip);
  if (!hit || hit.resetAt <= now) {
    lookupHits.set(ip, { count: 1, resetAt: now + LOOKUP_WINDOW_MS });
    return true;
  }
  hit.count += 1;
  return hit.count <= LOOKUP_LIMIT;
}

/**
 * Customer-facing catalogue. The public* operations need no login and return
 * only customer-safe fields; the rest are for signed-in staff.
 */
@Resolver()
export class PublicCatalogueResolver {
  constructor(private catalogue: PublicCatalogueService, private prisma: PrismaService) {}

  @Query(() => GraphQLJSON)
  publicCatalogueProduct(@Args('token') token: string) {
    return this.catalogue.publicProduct(token);
  }

  @Query(() => GraphQLJSON)
  publicCatalogueShare(@Args('token') token: string) {
    return this.catalogue.publicShare(token);
  }

  @Query(() => GraphQLJSON)
  publicShowroom() {
    return this.catalogue.publicShowroom();
  }

  @Mutation(() => GraphQLJSON)
  publicLabelLookup(
    @Args('code') code: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('visitToken', { nullable: true }) visitToken?: string,
  ) {
    if (!allowLookup(clientIp(ctx))) return { enabled: true, found: false, message: 'Too many scans in a minute. Please wait a moment and try again.' };
    return this.catalogue.publicLabelLookup(code, visitToken);
  }

  @Query(() => GraphQLJSON)
  async productCustomerLink(@Args('productId', { type: () => ID }) productId: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.catalogue.productCustomerLink(productId);
  }

  @Query(() => GraphQLJSON)
  async showroomPoster(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.catalogue.showroomPoster();
  }

  @Query(() => GraphQLJSON)
  async catalogueShares(@Context() ctx: GraphqlRequestContext, @Args('scope', { nullable: true }) scope?: string) {
    const user = await requireSession(this.prisma, ctx);
    const manager = user.effectivePermissions.includes('products.manage');
    return this.catalogue.listShares(user.id, manager && scope === 'all');
  }

  @Mutation(() => GraphQLJSON)
  async createCatalogueShare(@Args('input') input: CatalogueShareInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.catalogue.createShare(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async revokeCatalogueShare(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.catalogue.revokeShare(id, user.id, user.effectivePermissions.includes('products.manage'));
  }
}
