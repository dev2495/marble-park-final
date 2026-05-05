import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@ObjectType()
export class UserOutput {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  email!: string;

  @Field()
  role!: string;

  @Field({ nullable: true })
  phone?: string;

  @Field()
  active!: boolean;

  @Field(() => Date)
  createdAt!: Date;
}

@InputType()
export class CreateUserInput {
  @Field()
  name: string;

  @Field()
  email: string;

  @Field()
  password: string;

  @Field()
  role: string;

  @Field()
  phone: string;
}

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  role?: string;

  @Field({ nullable: true })
  active?: boolean;
}

@Resolver()
export class UsersResolver {
  constructor(
    private users: UsersService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [UserOutput])
  async getUsers(@Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.findAll();
  }

  @Query(() => [UserOutput], { name: 'users' })
  async usersList(@Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.findAll();
  }

  @Query(() => UserOutput)
  async user(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.findById(id);
  }

  @Mutation(() => UserOutput)
  async createUser(
    @Args('input') input: CreateUserInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.create(input);
  }

  @Mutation(() => UserOutput)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.update(id, input);
  }

  @Mutation(() => UserOutput)
  async deleteUser(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.users.delete(id);
  }
}
