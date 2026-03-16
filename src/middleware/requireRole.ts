import type { Request, Response, NextFunction } from 'express';
import type { AppRole, AppUser } from './requireAppUser';

function isAppRole(value: unknown): value is AppRole {
  return (
    value === 'client' ||
    value === 'coach' ||
    value === 'admin' ||
    value === 'staff'
  );
}

function getStoredUserRoles(user: AppUser | undefined): AppRole[] {
  if (!user) return [];

  if (Array.isArray(user.roles)) {
    const normalized = user.roles.filter(isAppRole);
    if (normalized.length > 0) return normalized;
  }

  if (isAppRole(user.role)) {
    return [user.role];
  }

  return [];
}

function expandRoles(roles: AppRole[]): AppRole[] {
  const expanded = new Set<AppRole>(roles);

  if (expanded.has('admin')) {
    expanded.add('coach');
    expanded.add('client');
  }

  if (expanded.has('coach')) {
    expanded.add('client');
  }

  return Array.from(expanded);
}

export function requireRole(allowed: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AppUser | undefined;
    const storedRoles = getStoredUserRoles(user);
    const effectiveRoles = expandRoles(storedRoles);

    if (effectiveRoles.length === 0) {
      return res.status(403).json({ message: 'Forbidden (missing role)' });
    }

    const hasAllowedRole = effectiveRoles.some((role) =>
      allowed.includes(role)
    );

    if (!hasAllowedRole) {
      return res.status(403).json({ message: 'Forbidden (insufficient role)' });
    }

    return next();
  };
}
