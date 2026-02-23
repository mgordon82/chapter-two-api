import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const currentUserRouter = Router();

currentUserRouter.get('/current-user', requireCognitoAuth, async (req, res) => {
  const claims = req.cognito;
  const sub = claims?.sub;

  const email =
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

  let user = await users.findOne({ 'auth.cognitoSub': sub });

  if (!user && email) {
    user = await users.findOne({ email });

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
