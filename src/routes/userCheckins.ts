import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const checkInsRouter = Router();

checkInsRouter.get('/current-user', requireCognitoAuth, async (req, res) => {
  try {
    const sub = req.cognito?.sub;
    if (!sub) return res.status(401).json({ message: 'Missing Cognito sub' });

    const db = getDb();
    const users = db.collection('users');
    const checkIns = db.collection('checkIns');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });
    if (!actor)
      return res.status(401).json({ message: 'User not found for this token' });

    const limitRaw = req.query.limit;
    const limit = Math.min(
      200,
      Math.max(1, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50)
    );

    const items = await checkIns
      .find({ userId: actor._id, isDeleted: false })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .toArray();

    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch check-ins' });
  }
});

checkInsRouter.post('/current-user', requireCognitoAuth, async (req, res) => {
  try {
    const sub = req.cognito?.sub;
    if (!sub) return res.status(401).json({ message: 'Missing Cognito sub' });

    const db = getDb();
    const users = db.collection('users');
    const checkIns = db.collection('checkIns');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });
    if (!actor)
      return res.status(401).json({ message: 'User not found for this token' });

    const { recordedAt, weightKg, notes } = req.body ?? {};

    const w = Number(weightKg);
    if (!Number.isFinite(w) || w < 20 || w > 300) {
      return res
        .status(400)
        .json({ message: 'weightKg must be a number between 20 and 300' });
    }

    const rAt = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(rAt.getTime())) {
      return res
        .status(400)
        .json({ message: 'recordedAt must be a valid ISO date string' });
    }

    const now = new Date();

    const doc = {
      userId: actor._id,
      recordedAt: rAt,
      metrics: {
        weightKg: w,
        notes: typeof notes === 'string' ? notes : ''
      },
      createdAt: now,
      createdByUserId: actor._id,
      isDeleted: false
    };

    const result = await checkIns.insertOne(doc);

    const userProfiles = db.collection('userProfiles');

    const profileUpdate = await userProfiles.updateOne(
      { userId: actor._id },
      {
        $set: {
          weightKg: doc.metrics.weightKg,
          updatedAt: now
        }
      }
    );

    if (profileUpdate.matchedCount === 0) {
      console.warn(`[checkIns] No userProfile found for userId=${actor._id}`);
    }

    return res.status(201).json({ ok: true, id: result.insertedId });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create check-in' });
  }
});

checkInsRouter.delete(
  '/current-user/:id',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) return res.status(401).json({ message: 'Missing Cognito sub' });

      const db = getDb();
      const users = db.collection('users');
      const checkIns = db.collection('checkIns');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor)
        return res
          .status(401)
          .json({ message: 'User not found for this token' });

      // Force id to a single string
      const idParam = req.params?.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) return res.status(400).json({ message: 'Missing id' });
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }

      const now = new Date();

      const result = await checkIns.updateOne(
        {
          _id: new ObjectId(id),
          userId: actor._id,
          isDeleted: false
        },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            deletedByUserId: actor._id
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to delete check-in' });
    }
  }
);
