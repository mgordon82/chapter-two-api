import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const currentUserRouter = Router();

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

  // Prefer any explicit displayName if you ever add it back later
  const displayNameFromUser = safeTrim((user as any)?.displayName);

  // ✅ Full email fallback (NOT email prefix)
  const fullEmail = safeTrim((user as any)?.email) ?? emailFromClaims;

  const computedDisplayName =
    displayNameFromUser ?? displayNameFromProfile ?? fullEmail;

  return res.json({
    id: String((user as any)._id),
    email: (user as any).email ?? emailFromClaims ?? null,
    displayName: computedDisplayName,
    role: (user as any).role ?? null,
    status: (user as any).status ?? null
  });
});
