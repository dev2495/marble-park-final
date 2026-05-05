import { Resolver, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { DocumentsService } from './documents.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class DocumentOutput {
  @Field({ nullable: true })
  id?: string;

  @Field({ nullable: true })
  data?: string;

  @Field({ nullable: true })
  contentType?: string;

  @Field({ nullable: true })
  url?: string;

  @Field(() => Boolean, { nullable: true })
  success?: boolean;

  @Field({ nullable: true })
  messageId?: string;
}

@InputType()
export class SendEmailInput {
  @Field()
  to: string;

  @Field()
  subject: string;

  @Field()
  body: string;

  @Field(() => ID, { nullable: true })
  quoteId?: string;
}

@Resolver()
export class DocumentsResolver {
  constructor(
    private documents: DocumentsService,
    private prisma: PrismaService,
  ) {}

  @Mutation(() => DocumentOutput)
  async generateQuotePdf(@Args('quoteId', { type: () => ID }) quoteId: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.documents.generateQuotePdf(quoteId);
  }

  @Mutation(() => DocumentOutput)
  async sendQuoteEmail(@Args('input') input: SendEmailInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales']);
    return this.documents.sendQuoteEmail(input);
  }
}
