import { Resolver, Query, Args, ObjectType, Field, Context } from '@nestjs/graphql';
import { SearchService } from './search.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
class SearchResult {
  @Field(() => GraphQLJSON)
  products: any;

  @Field(() => GraphQLJSON, { deprecationReason: 'Use searchEverything; always empty, so results follow each page’s access rules.' })
  leads: any;

  @Field(() => GraphQLJSON, { deprecationReason: 'Use searchEverything; always empty, so results follow each page’s access rules.' })
  quotes: any;
}

@Resolver()
export class SearchResolver {
  constructor(
    private searchService: SearchService,
    private prisma: PrismaService,
  ) {}

  /** Product picker search for quotes, orders, intents and procurement. */
  @Query(() => SearchResult)
  async globalSearch(@Args('query') query: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return { products: await this.searchService.products(query), leads: [], quotes: [] };
  }

  /** Header search: grouped results, limited to what this person may open. */
  @Query(() => [GraphQLJSON])
  async searchEverything(@Args('query') query: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.searchService.everything(query, user);
  }
}
