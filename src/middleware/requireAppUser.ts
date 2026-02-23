import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../config/db';

export type AppUser = {
  _id: unknown;
  role: string;
  email: string;
  displayName?: string | null;
  status: string;
  auth?: { cognitoSub?: string };
  createdAt?: Date;
  updatedAt?: Date;
};

export async function requireAppUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const sub = req.cognito?.sub;

  if (!sub) {
    return res.status(401).json({ message: 'Unauthorized (missing sub)' });
  }

  const db = getDb();
  const users = db.collection('users');

  const user = await users.findOne({ 'auth.cognitoSub': sub });

  if (!user) {
    return res
      .status(403)
      .json({ message: 'No access (user not provisioned)' });
  }

  (req as any).user = user as AppUser;
  return next();
}
