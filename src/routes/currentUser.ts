import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const currentUserRouter = Router();

/**
 * GET /api/current-user
 * - Requires Cognito access token
 * - Finds Mongo user (must exist)
 * - Returns basic profile for UI header + routing
 */
currentUserRouter.get('/current-user', requireCognitoAuth, async (req, res) => {
  const claims = req.cognito;
  const sub = claims?.sub;

  // email might not exist on access token depending on Cognito config
  const email =
    typeof claims?.email === 'string'
      ? claims.email.toLowerCase().trim()
      : null;

  if (!sub) {
    return res.status(401).json({ message: 'Unauthorized (missing sub)' });
  }

  const db = getDb();
  const users = db.collection('users');

  // 1) Prefer stable Cognito sub mapping
  let user = await users.findOne({ 'auth.cognitoSub': sub });

  // 2) Fallback to email for first-time linking (if available)
  if (!user && email) {
    user = await users.findOne({ email });

    // If found, link auth.cognitoSub for future requests
    if (user && !(user as any).auth?.cognitoSub) {
      await users.updateOne(
        { _id: new ObjectId(String(user._id)) },
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

  // Enforce: user must exist in Mongo
  if (!user) {
    return res
      .status(403)
      .json({ message: 'No access (user not provisioned)' });
  }

  return res.json({
    id: String(user._id),
    email: (user as any).email ?? null,
    displayName: (user as any).displayName ?? null,
    role: (user as any).role ?? null,
    status: (user as any).status ?? null
  });
});
