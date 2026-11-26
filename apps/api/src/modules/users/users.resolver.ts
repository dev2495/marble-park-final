import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context, ResolveField, Parent } from '@nestjs/graphql';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requirePermission, requireSession, sessionToken } from '../auth/session-context';
import { GraphQLJSON } from 'graphql-scalars';
import { OptionalEmail, OptionalPhone, TextLimit } from '../common/input-rules';
import { IMPLIED_PERMISSIONS, PERMISSION_CATALOG, PERMISSION_GROUPS, ROLE_PERMISSIONS, effectivePermissionsForUser, roleDefaultPermissions } from '../auth/rbac';

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

  @Field(() => GraphQLJSON)
  permissionOverrides!: any;

  @Field(() => [String])
  effectivePermissions!: string[];

  @Field(() => Date, { nullable: true })
  passwordChangedAt?: Date;

  @Field(() => Date)
  createdAt!: Date;
}

@InputType()
export class CreateUserInput {
  @Field()
  @TextLimit(120)
  name!: string;

  @Field()
  @OptionalEmail()
  email!: string;

  @Field()
  password!: string;

  @Field()
  role!: string;

  @Field()
  @OptionalPhone()
  phone!: string;

  @Field({ nullable: true, description: '/catalogue-images/manual/<file>.png from /api/upload, or null to remove' })
  avatarUrl?: string;

  @Field({ nullable: true })
  @TextLimit(280)
  bio?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  permissionOverrides?: any;
}

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  @TextLimit(120)
  name?: string;

  @Field({ nullable: true })
  @OptionalEmail()
  email?: string;

  @Field({ nullable: true })
  @OptionalPhone()
  phone?: string;

  @Field({ nullable: true })
  role?: string;

  @Field({ nullable: true })
  active?: boolean;

  @Field({ nullable: true })
  password?: string;

  @Field({ nullable: true, description: '/catalogue-images/manual/<file>.png from /api/upload, or null to remove' })
  avatarUrl?: string;

  @Field({ nullable: true })
  @TextLimit(280)
  bio?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  permissionOverrides?: any;
}

@InputType()
export class UpdateMyProfileInput {
  @Field({ nullable: true })
  @TextLimit(120)
  name?: string;

  @Field({ nullable: true })
  @OptionalEmail()
  email?: string;

  @Field({ nullable: true })
  @OptionalPhone()
  phone?: string;

  @Field({ nullable: true, description: '/catalogue-images/manual/<file>.png from /api/upload, or null to remove' })
  avatarUrl?: string;

  @Field({ nullable: true })
  @TextLimit(280)
  bio?: string;

  @Field({ nullable: true, description: 'Needed when the login email changes.' })
  currentPassword?: string;
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

@Resolver(() => UserOutput)
export class UsersResolver {
  constructor(
    private users: UsersService,
    private prisma: PrismaService,
  ) {}

  @ResolveField('effectivePermissions', () => [String])
  effectivePermissions(@Parent() user: any) {
    return effectivePermissionsForUser(user);
  }

  /** Current signed-in user — hydrates the profile page + sidebar avatar. */
  @Query(() => UserOutput, { name: 'me', description: 'Current authenticated user.' })
  async me(@Context() ctx: GraphqlRequestContext) {
    const session = await requireSession(this.prisma, ctx);
    return this.users.findById(session.id);
  }

  @Query(() => [UserOutput])
  async getUsers(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.findAll();
  }

  @Query(() => GraphQLJSON, { name: 'permissionCatalog', description: 'Every right with its label, group, role defaults and implied rights.' })
  async permissionCatalog(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'users.manage');
    return {
      groups: PERMISSION_GROUPS,
      permissions: PERMISSION_CATALOG,
      implied: IMPLIED_PERMISSIONS,
      roles: Object.keys(ROLE_PERMISSIONS).map((role) => ({ role, defaults: roleDefaultPermissions(role) })),
    };
  }

  @Query(() => [UserOutput], { name: 'users' })
  async usersList(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.findAll();
  }

  @Query(() => UserOutput)
  async user(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.findById(id);
  }

  @Mutation(() => UserOutput)
  async createUser(
    @Args('input') input: CreateUserInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const actor = await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.create(input, actor.id);
  }

  @Mutation(() => UserOutput)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const actor = await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.update(id, input, actor.id);
  }

  @Mutation(() => UserOutput)
  async deleteUser(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const actor = await requirePermission(this.prisma, ctx, 'users.manage');
    return this.users.delete(id, actor.id);
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
    return this.users.changeMyPassword(session.id, input, sessionToken(ctx));
  }
}
