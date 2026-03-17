import { Router } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';

import { getDb } from '../config/db';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { requireAppUser } from '../middleware/requireAppUser';

export const userProfileRouter = Router();

const upsertSchema = z.object({
  profile: z.object({
    firstName: z.string().max(80).nullable(),
    lastName: z.string().max(80).nullable(),
    gender: z.string().nullable(),
    age: z.number().int().min(0).max(120).nullable(),

    heightCm: z.number().min(0).nullable(),
    weightKg: z.number().min(0).nullable(),
    goalWeightKg: z.number().min(0).nullable(),
    stepGoalDaily: z.number().int().min(0).nullable(),
    waterGoalDailyMl: z.number().int().min(0).nullable(),

    activityLevel: z.string().nullable(),
    goal: z.string().nullable(),
    rateLevel: z.string().nullable(),

    preferences: z.object({
      measurementUnitPref: z.string(),
      weightUnitPref: z.string(),
      volumeUnitPref: z.string()
    })
  }),

  calculated: z.object({
    bmr: z.number().nullable(),
    tdee: z.number().nullable(),
    weightGoal: z.unknown()
  }),

  nutrition: z.object({
    targets: z.object({
      calories: z.number().int().min(0),
      protein: z.number().int().min(0),
      carbs: z.number().int().min(0),
      fats: z.number().int().min(0)
    })
  })
});

type UpsertBody = z.infer<typeof upsertSchema>;

userProfileRouter.put(
  '/',
  requireCognitoAuth,
  requireAppUser,
  async (req, res) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    const body: UpsertBody = parsed.data;

    const db = getDb();
    const now = new Date();
    const userId = new ObjectId(String((req.user as any)._id));

    const userProfiles = db.collection('userProfiles');
    const nutritionSettings = db.collection('nutritionSettings');

    try {
      await userProfiles.updateOne(
        { userId },
        {
          $setOnInsert: {
            userId,
            createdAt: now
          },
          $set: {
            firstName: body.profile.firstName,
            lastName: body.profile.lastName,
            gender: body.profile.gender,
            age: body.profile.age,

            heightCm: body.profile.heightCm,
            weightKg: body.profile.weightKg,
            goalWeightKg: body.profile.goalWeightKg,
            stepGoalDaily: body.profile.stepGoalDaily,
            waterGoalDailyMl: body.profile.waterGoalDailyMl,

            activityLevel: body.profile.activityLevel,
            goal: body.profile.goal,
            rateLevel: body.profile.rateLevel,

            preferences: {
              measurementUnitPref: body.profile.preferences.measurementUnitPref,
              weightUnitPref: body.profile.preferences.weightUnitPref,
              volumeUnitPref: body.profile.preferences.volumeUnitPref
            },

            calculated: {
              bmr: body.calculated.bmr,
              tdee: body.calculated.tdee,
              weightGoal: body.calculated.weightGoal
            },

            updatedAt: now
          }
        },
        { upsert: true }
      );

      await nutritionSettings.updateOne(
        { userId },
        {
          $setOnInsert: {
            userId,
            details: '',
            createdAt: now
          },
          $set: {
            targets: body.nutrition.targets,

            preferences: {
              allergies: [],
              avoidFoods: [],
              preferredFoods: [],
              dietStyle: null,
              mealsPerDay: 4
            },
            updatedByUserId: userId,
            updatedAt: now
          }
        },
        { upsert: true }
      );

      return res.status(200).json({ ok: true });
    } catch (err: any) {
      if (err?.code === 121) {
        console.error(
          'Schema validation failed:',
          JSON.stringify(err?.errInfo?.details, null, 2)
        );
        return res.status(400).json({
          message: 'Schema validation failed',
          details: err?.errInfo?.details
        });
      }

      console.error('Unhandled error:', err);
      return res.status(500).json({ message: 'Failed to save profile' });
    }
  }
);

userProfileRouter.get(
  '/',
  requireCognitoAuth,
  requireAppUser,
  async (req, res) => {
    const db = getDb();
    const userId = new ObjectId(String((req.user as any)._id));

    const userProfiles = db.collection('userProfiles');
    const nutritionSettings = db.collection('nutritionSettings');

    const [profileDoc, nutritionDoc] = await Promise.all([
      userProfiles.findOne({ userId }),
      nutritionSettings.findOne({ userId })
    ]);

    return res.status(200).json({
      profile: {
        firstName: (profileDoc as any)?.firstName ?? null,
        lastName: (profileDoc as any)?.lastName ?? null,
        gender: (profileDoc as any)?.gender ?? null,
        age: (profileDoc as any)?.age ?? null,
        heightCm: (profileDoc as any)?.heightCm ?? null,
        weightKg: (profileDoc as any)?.weightKg ?? null,
        goalWeightKg: (profileDoc as any)?.goalWeightKg ?? null,
        stepGoalDaily: (profileDoc as any)?.stepGoalDaily ?? null,
        waterGoalDailyMl: (profileDoc as any)?.waterGoalDailyMl ?? null,
        activityLevel: (profileDoc as any)?.activityLevel ?? null,
        goal: (profileDoc as any)?.goal ?? null,
        rateLevel: (profileDoc as any)?.rateLevel ?? null,
        preferences: {
          measurementUnitPref:
            (profileDoc as any)?.preferences?.measurementUnitPref ?? 'cm',
          weightUnitPref:
            (profileDoc as any)?.preferences?.weightUnitPref ?? 'kg',
          volumeUnitPref:
            (profileDoc as any)?.preferences?.volumeUnitPref ?? 'ml'
        }
      },
      calculated: {
        bmr: (profileDoc as any)?.calculated?.bmr ?? null,
        tdee: (profileDoc as any)?.calculated?.tdee ?? null,
        weightGoal: (profileDoc as any)?.calculated?.weightGoal ?? null
      },
      nutrition: {
        targets: {
          calories: (nutritionDoc as any)?.targets?.calories ?? 0,
          protein: (nutritionDoc as any)?.targets?.protein ?? 0,
          carbs: (nutritionDoc as any)?.targets?.carbs ?? 0,
          fats: (nutritionDoc as any)?.targets?.fats ?? 0
        }
      }
    });
  }
);
