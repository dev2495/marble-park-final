import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type GraphqlRequestContext = {
  req?: {
    headers?: Record<string, string | string[] | undefined>;
  };
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function bearerToken(ctx: GraphqlRequestContext): string {
  const raw = ctx.req?.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

export async function getSessionUser(prisma: PrismaService, ctx: GraphqlRequestContext): Promise<SessionUser | null> {
  const token = bearerToken(ctx);
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new UnauthorizedException('Session expired');
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) {
    throw new UnauthorizedException('Account is disabled or missing');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function requireRoles(
  prisma: PrismaService,
  ctx: GraphqlRequestContext,
  roles: string[],
): Promise<SessionUser> {
  const user = await getSessionUser(prisma, ctx);
  if (!user) throw new UnauthorizedException('Login required');
  if (!roles.includes(user.role)) {
    throw new ForbiddenException('This action is restricted');
  }
  return user;
}

export async function requireSession(
  prisma: PrismaService,
  ctx: GraphqlRequestContext,
): Promise<SessionUser> {
  const user = await getSessionUser(prisma, ctx);
  if (!user) throw new UnauthorizedException('Login required');
  return user;
}

export function isPrivileged(user: SessionUser): boolean {
  return ['admin', 'owner', 'sales_manager'].includes(user.role);
}
