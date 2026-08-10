import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AppDataLoaders } from '../common/dataloaders';
import { PermissionKey, effectivePermissionsForUser, hasPermission } from './rbac';

export type GraphqlRequestContext = {
  requestId?: string;
  req?: {
    headers?: Record<string, string | string[] | undefined>;
  };
  res?: {
    cookie?: (name: string, value: string, options?: Record<string, unknown>) => void;
    clearCookie?: (name: string, options?: Record<string, unknown>) => void;
  };
  loaders?: AppDataLoaders;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissionOverrides: Record<string, boolean>;
  effectivePermissions: PermissionKey[];
};

function bearerToken(ctx: GraphqlRequestContext): string {
  const raw = ctx.req?.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

function cookieToken(ctx: GraphqlRequestContext): string {
  const raw = ctx.req?.headers?.cookie;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return '';
  const match = header.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('mp_session='));
  if (!match) return '';
  try {
    return decodeURIComponent(match.slice('mp_session='.length)).trim();
  } catch {
    return '';
  }
}

export function sessionToken(ctx: GraphqlRequestContext): string {
  return cookieToken(ctx) || bearerToken(ctx);
}

export async function getSessionUser(prisma: PrismaService, ctx: GraphqlRequestContext): Promise<SessionUser | null> {
  const token = sessionToken(ctx);
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new UnauthorizedException('Session expired');
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new UnauthorizedException('Account is disabled or missing');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissionOverrides: (user as any).permissionOverrides || {},
    effectivePermissions: effectivePermissionsForUser(user as any),
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

export async function requirePermission(
  prisma: PrismaService,
  ctx: GraphqlRequestContext,
  permission: PermissionKey,
  fallbackRoles: string[] = [],
): Promise<SessionUser> {
  const user = await getSessionUser(prisma, ctx);
  if (!user) throw new UnauthorizedException('Login required');
  if (fallbackRoles.includes(user.role) || hasPermission(user, permission)) return user;
  throw new ForbiddenException('This action is restricted');
}

export async function requireAnyPermission(
  prisma: PrismaService,
  ctx: GraphqlRequestContext,
  permissions: PermissionKey[],
  fallbackRoles: string[] = [],
): Promise<SessionUser> {
  const user = await getSessionUser(prisma, ctx);
  if (!user) throw new UnauthorizedException('Login required');
  if (fallbackRoles.includes(user.role) || permissions.some((permission) => hasPermission(user, permission))) return user;
  throw new ForbiddenException('This action is restricted');
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
