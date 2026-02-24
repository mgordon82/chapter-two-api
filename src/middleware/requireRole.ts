import type { Request, Response, NextFunction } from 'express';
import type { AppUser } from './requireAppUser';

export function requireRole(allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AppUser | undefined;
    const role = user?.role;

    if (!role) {
      return res.status(403).json({ message: 'Forbidden (missing role)' });
    }

    if (!allowed.includes(role)) {
      return res.status(403).json({ message: 'Forbidden (insufficient role)' });
    }

    return next();
  };
}
