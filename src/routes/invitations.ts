import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../config/db';

export const invitationsRouter = Router();

function hashInviteToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const submitInvitationSchema = z.object({
  userId: z.string().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().trim().min(1),
  pronouns: z.string().trim().nullable(),

  address: z.object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
    zip: z.string().trim().min(1).max(20),
    country: z.string().trim().min(1).max(80)
  }),

  weightKg: z.number().nullable(),
  heightCm: z.number().nullable(),
  job: z.string().trim().min(1).max(120),

  training: z.object({
    location: z.string().trim().min(1),
    homeEquipment: z.array(z.string().trim()),
    gymEquipment: z.array(z.string().trim()),
    daysPerWeek: z.number().int().min(0).max(7),
    days: z.array(z.string().trim()),
    sessionTime: z.string().trim().min(1)
  }),

  injuries: z.object({
    has: z.boolean(),
    details: z.string().trim()
  }),

  nutrition: z.object({
    followedApproach: z.boolean(),
    approachDetails: z.string().trim(),
    perfectNutrition: z.string().trim().min(1),
    favoriteFoods: z.string().trim().min(1),
    leastFavoriteFoods: z.string().trim().min(1)
  }),

  motivation: z.object({
    reason: z.string().trim().min(1),
    style: z.string().trim().min(1),
    interestedInExtraIncome: z.boolean()
  })
});

//
// ✅ GET with token validation
//
invitationsRouter.get('/:userId/:token', async (req, res) => {
  const userIdParam = req.params.userId;
  const token = req.params.token;

  if (!ObjectId.isValid(userIdParam) || !token) {
    return res.status(400).json({ message: 'Invalid invitation link' });
  }

  try {
    const db = getDb();
    const users = db.collection('users');
    const userProfiles = db.collection('userProfiles');

    const userId = new ObjectId(userIdParam);

    const user = await users.findOne({ _id: userId });

    if (!user) {
      return res.status(404).json({ message: 'Invitation not found' });
    }

    const tokenCreatedAt = (user as any)?.inviteTokenCreatedAt;

    if (!tokenCreatedAt) {
      return res.status(403).json({ message: 'Invalid invitation' });
    }

    const ageMs = Date.now() - new Date(tokenCreatedAt).getTime();
    const maxAgeMs = 1000 * 60 * 60 * 48; // 48 hours

    if (ageMs > maxAgeMs) {
      return res.status(403).json({ message: 'Invitation has expired' });
    }

    const expectedHash = (user as any)?.inviteTokenHash;

    if (!expectedHash) {
      return res.status(403).json({ message: 'Invalid invitation' });
    }

    const incomingHash = hashInviteToken(token);

    if (incomingHash !== expectedHash) {
      return res.status(403).json({ message: 'Invalid invitation token' });
    }

    const profile = await userProfiles.findOne({ userId });

    const onboardingStatus =
      typeof (profile as any)?.onboardingStatus === 'string'
        ? (profile as any).onboardingStatus
        : null;

    return res.status(200).json({
      ok: true,
      invitation: {
        userId: userIdParam,
        email: (user as any).email ?? '',
        status: (user as any).status ?? null,
        onboardingStatus
      }
    });
  } catch (err) {
    console.error('Load invitation error:', err);
    return res.status(500).json({ message: 'Failed to load invitation' });
  }
});

//
// ✅ POST with token validation
//
invitationsRouter.post('/:userId/:token/submit', async (req, res) => {
  const userIdParam = req.params.userId;
  const token = req.params.token;

  if (!ObjectId.isValid(userIdParam) || !token) {
    return res.status(400).json({ message: 'Invalid invitation link' });
  }

  const parsed = submitInvitationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid request body',
      details: parsed.error.flatten()
    });
  }

  try {
    const db = getDb();
    const users = db.collection('users');
    const userProfiles = db.collection('userProfiles');

    const userId = new ObjectId(userIdParam);
    const now = new Date();

    const user = await users.findOne({ _id: userId });

    if (!user) {
      return res.status(404).json({ message: 'Invited user not found' });
    }

    const tokenCreatedAt = (user as any)?.inviteTokenCreatedAt;

    if (!tokenCreatedAt) {
      return res.status(403).json({ message: 'Invalid invitation' });
    }

    const ageMs = Date.now() - new Date(tokenCreatedAt).getTime();
    const maxAgeMs = 1000 * 60 * 60 * 48; // 48 hours

    if (ageMs > maxAgeMs) {
      return res.status(403).json({ message: 'Invitation has expired' });
    }

    const expectedHash = (user as any)?.inviteTokenHash;

    if (!expectedHash) {
      return res.status(403).json({ message: 'Invalid invitation' });
    }

    const incomingHash = hashInviteToken(token);

    if (incomingHash !== expectedHash) {
      return res.status(403).json({ message: 'Invalid invitation token' });
    }

    const payload = parsed.data;

    const result = await userProfiles.updateOne(
      { userId },
      {
        $setOnInsert: {
          userId,
          createdAt: now
        },
        $set: {
          firstName: payload.firstName,
          lastName: payload.lastName,
          dateOfBirth: payload.dateOfBirth,
          pronouns: payload.pronouns,
          heightCm: payload.heightCm,
          weightKg: payload.weightKg,
          job: payload.job,

          onboardingAddress: payload.address,
          onboardingTraining: payload.training,
          onboardingInjuries: payload.injuries,
          onboardingNutrition: payload.nutrition,
          onboardingMotivation: payload.motivation,

          onboardingStatus: 'completed',
          onboardingSubmittedAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );

    await users.updateOne(
      { _id: userId },
      {
        $set: {
          status: 'active',
          updatedAt: now
        },
        $unset: {
          inviteTokenHash: '',
          inviteTokenCreatedAt: ''
        }
      }
    );

    return res.status(200).json({
      ok: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId: result.upsertedId ?? null
    });
  } catch (err) {
    console.error('Submit invitation onboarding error:', err);
    return res
      .status(500)
      .json({ message: 'Failed to submit invitation onboarding' });
  }
});
