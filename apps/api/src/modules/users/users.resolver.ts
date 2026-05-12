import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';

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

  @Field({ nullable: true, description: 'Uploaded avatar URL; null falls back to seeded initials on the client.' })
  avatarUrl?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field(() => Date, { nullable: true })
  passwordChangedAt?: Date;

  @Field(() => Date)
  createdAt!: Date;
}

@InputType()
export class CreateUserInput {
  @Field()
  name!: string;

  @Field()
  email!: string;

  @Field()
  password!: string;

  @Field()
  role!: string;

  @Field()
  phone!: string;
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

@InputType()
export class UpdateMyProfileInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true, description: '/catalogue-images/manual/<file>.png from /api/upload, or null to remove' })
  avatarUrl?: string;

  @Field({ nullable: true })
  bio?: string;
}

@InputType()
export class ChangeMyPasswordInput {
  @Field()
  currentPassword!: string;

  @Field()
  newPassword!: string;
}

@ObjectType()
export class PasswordChangeResult {
  @Field()
  ok!: boolean;

  @Field(() => Date)
  passwordChangedAt!: Date;
}

@Resolver()
export class UsersResolver {
  constructor(
    private users: UsersService,
    private prisma: PrismaService,
  ) {}

  /** Current signed-in user — hydrates the profile page + sidebar avatar. */
  @Query(() => UserOutput, { name: 'me', description: 'Current authenticated user.' })
  async me(@Context() ctx: GraphqlRequestContext) {
    const session = await requireSession(this.prisma, ctx);
    return this.users.findById(session.id);
  }

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

  /** Self-service profile update. Any signed-in user can edit their own row. */
  @Mutation(() => UserOutput)
  async updateMyProfile(
    @Args('input') input: UpdateMyProfileInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const session = await requireSession(this.prisma, ctx);
    return this.users.updateMyProfile(session.id, input as any);
  }

  /** Self-service password change. Requires the current password. */
  @Mutation(() => PasswordChangeResult)
  async changeMyPassword(
    @Args('input') input: ChangeMyPasswordInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const session = await requireSession(this.prisma, ctx);
    return this.users.changeMyPassword(session.id, input);
  }
}
