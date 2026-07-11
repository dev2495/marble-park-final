import { Resolver, Mutation, Args, Context, InputType, Field, ObjectType } from '@nestjs/graphql';
import { AuthService } from './auth.service';
import { GraphqlRequestContext, sessionToken } from './session-context';

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
  async login(
    @Args('input') input: LoginInput,
    @Context() ctx: GraphqlRequestContext & { req?: { ip?: string; headers?: Record<string, string | string[] | undefined> } },
  ) {
    const result = await this.auth.login(
      input,
      ctx.req?.ip,
      Array.isArray(ctx.req?.headers?.['user-agent']) ? ctx.req?.headers?.['user-agent'][0] : ctx.req?.headers?.['user-agent'],
    );
    ctx.res?.cookie?.('mp_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return result;
  }

  @Mutation(() => Boolean)
  async logout(@Context() ctx: GraphqlRequestContext) {
    const token = sessionToken(ctx);
    if (token) await this.auth.logoutByToken(token);
    ctx.res?.clearCookie?.('mp_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
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

}
