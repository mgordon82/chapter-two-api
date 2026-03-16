import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const currentUserRouter = Router();

type AppRole = 'client' | 'coach' | 'admin' | 'staff';

const VALID_ROLES: AppRole[] = ['client', 'coach', 'admin', 'staff'];

function safeTrim(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function nameFromParts(first: unknown, last: unknown): string | null {
  const f = safeTrim(first);
  const l = safeTrim(last);
  const combined = [f, l].filter(Boolean).join(' ');
  return combined.length > 0 ? combined : null;
}

function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && VALID_ROLES.includes(value as AppRole);
}

function normalizeRoles(user: any): AppRole[] {
  if (Array.isArray(user?.roles)) {
    return user.roles.filter(isAppRole);
  }

  if (isAppRole(user?.role)) {
    return [user.role];
  }

  return [];
}

currentUserRouter.get('/current-user', requireCognitoAuth, async (req, res) => {
  const claims = req.cognito;
  const sub = claims?.sub;

  const emailFromClaims =
    typeof claims?.email === 'string'
      ? claims.email.toLowerCase().trim()
      : typeof claims?.username === 'string'
      ? claims.username.toLowerCase().trim()
      : null;

  if (!sub) {
    return res.status(401).json({ message: 'Unauthorized (missing sub)' });
  }

  const db = getDb();
  const users = db.collection('users');
  const userProfiles = db.collection('userProfiles');

  let user = await users.findOne({ 'auth.cognitoSub': sub });

  if (!user && emailFromClaims) {
    user = await users.findOne({ email: emailFromClaims });

    if (user && !(user as any).auth?.cognitoSub) {
      await users.updateOne(
        { _id: new ObjectId(String((user as any)._id)) },
        {
          $set: {
            'auth.cognitoSub': sub,
            'auth.updatedAt': new Date(),
            updatedAt: new Date()
          }
        }
      );
    }
  }

  if (!user) {
    return res
      .status(403)
      .json({ message: 'No access (user not provisioned)' });
  }

  const userId = new ObjectId(String((user as any)._id));
  const profileDoc = await userProfiles.findOne({ userId });

  const displayNameFromProfile = nameFromParts(
    (profileDoc as any)?.firstName,
    (profileDoc as any)?.lastName
  );

  const displayNameFromUser = safeTrim((user as any)?.displayName);
  const fullEmail = safeTrim((user as any)?.email) ?? emailFromClaims;
  const computedDisplayName =
    displayNameFromUser ?? displayNameFromProfile ?? fullEmail;

  const roles = normalizeRoles(user);
  const role = roles[0] ?? null;

  return res.json({
    id: String((user as any)._id),
    email: (user as any).email ?? emailFromClaims ?? null,
    displayName: computedDisplayName,
    role,
    roles,
    status: (user as any).status ?? null
  });
});
