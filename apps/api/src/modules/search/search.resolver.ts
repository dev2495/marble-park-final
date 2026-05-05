import { Resolver, Query, Args, ObjectType, Field, Context } from '@nestjs/graphql';
import { SearchService } from './search.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
class SearchResult {
  @Field(() => GraphQLJSON)
  products: any;

  @Field(() => GraphQLJSON)
  leads: any;

  @Field(() => GraphQLJSON)
  quotes: any;
}

@Resolver()
export class SearchResolver {
  constructor(
    private searchService: SearchService,
    private prisma: PrismaService,
  ) {}

  @Query(() => SearchResult)
  async globalSearch(@Args('query') query: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.searchService.search(query);
  }
}
