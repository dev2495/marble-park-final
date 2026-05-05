import { Resolver, Mutation, Args, Query, Context, InputType, Field, ObjectType } from '@nestjs/graphql';
import { AuthService } from './auth.service';

import { IsEmail, IsString, IsNotEmpty } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsEmail()
  email!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

@ObjectType()
export class UserInfo {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  email!: string;

  @Field()
  role!: string;
}

@ObjectType()
export class AuthResult {
  @Field({ nullable: true })
  token?: string;

  @Field(() => UserInfo, { nullable: true })
  user?: UserInfo;

  @Field()
  authenticated!: boolean;
}

@Resolver()
export class AuthResolver {
  constructor(private auth: AuthService) {}

  @Mutation(() => AuthResult)
  login(
    @Args('input') input: LoginInput,
    @Context() ctx: { req?: { ip?: string; headers?: { 'user-agent'?: string } } },
  ) {
    return this.auth.login(
      input,
      ctx.req?.ip,
      ctx.req?.headers?.['user-agent'],
    );
  }

  @Mutation(() => Boolean)
  async logout(@Args('sessionId') sessionId: string) {
    await this.auth.logout(sessionId);
    return true;
  }

  @Mutation(() => Boolean)
  async requestPasswordReset(@Args('email') email: string) {
    await this.auth.requestPasswordReset(email);
    return true;
  }

  @Mutation(() => Boolean)
  async resetPassword(
    @Args('token') token: string,
    @Args('newPassword') newPassword: string,
  ) {
    await this.auth.resetPassword(token, newPassword);
    return true;
  }

  @Query(() => AuthResult)
  async me(@Args('token') token: string) {
    const session = await this.auth.validateSession(token);
    if (!session) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: {
        id: session.userId,
        name: session.name,
        email: session.email,
        role: session.role,
      },
    };
  }
}
