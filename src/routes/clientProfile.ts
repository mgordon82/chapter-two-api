import { Router } from 'express';
import { ObjectId } from 'mongodb';

import { getDb } from '../config/db';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { requireAppUser } from '../middleware/requireAppUser';
import { createSignedPhotoViewUrl } from '../utils/r2Uploads';

export const clientProfileRouter = Router();

const toIsoOrNull = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();
  return null;
};

const toDisplayWeight = (value: unknown) => {
  return typeof value === 'number' ? `${value} kg` : null;
};

const toDisplayHeight = (value: unknown) => {
  return typeof value === 'number' ? `${value} cm` : null;
};

clientProfileRouter.get(
  '/:userId',
  requireCognitoAuth,
  requireAppUser,
  async (req, res) => {
    const db = getDb();
    const { userId } = req.params as { userId: string };

    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({
        message: 'Invalid user id'
      });
    }

    const targetUserId = new ObjectId(userId);

    const users = db.collection('users');
    const userProfiles = db.collection('userProfiles');
    const nutritionSettings = db.collection('nutritionSettings');
    const checkIns = db.collection('checkIns');
    const photoSets = db.collection('photoSets');
    const healthMetricDaily = db.collection('healthMetricDaily');

    const [
      userDoc,
      profileDoc,
      nutritionDoc,
      latestCheckInDoc,
      weightTrendDocs,
      latestProgressPhotoSetDoc,
      progressPhotoSetCount,
      checkInHistoryDocs
    ] = await Promise.all([
      users.findOne({ _id: targetUserId }),

      userProfiles.findOne({ userId: targetUserId }),

      nutritionSettings.findOne({ userId: targetUserId }),

      checkIns.findOne(
        {
          userId: targetUserId,
          isDeleted: false
        },
        {
          sort: { recordedAt: -1 }
        }
      ),

      checkIns
        .find({
          userId: targetUserId,
          isDeleted: false,
          'metrics.weightKg': { $type: 'number' }
        })
        .sort({ recordedAt: 1 })
        .toArray(),

      photoSets.findOne(
        {
          userId: targetUserId,
          type: 'progress',
          isDeleted: false,
          status: { $in: ['finalized', 'attached'] }
        },
        {
          sort: {
            attachedAt: -1,
            finalizedAt: -1,
            createdAt: -1
          }
        }
      ),

      photoSets.countDocuments({
        userId: targetUserId,
        type: 'progress',
        isDeleted: false,
        status: { $in: ['finalized', 'attached'] }
      }),

      checkIns
        .find({
          userId: targetUserId,
          isDeleted: false
        })
        .sort({ recordedAt: -1 })
        .toArray()
    ]);
    const latestCheckInDate =
      typeof (latestCheckInDoc as any)?.periodKey === 'string'
        ? (latestCheckInDoc as any).periodKey
        : (latestCheckInDoc as any)?.representedDate instanceof Date
        ? (latestCheckInDoc as any).representedDate.toISOString().slice(0, 10)
        : null;

    const latestStepsDoc = latestCheckInDate
      ? await healthMetricDaily.findOne({
          userId: targetUserId,
          isDeleted: false,
          metricType: 'steps',
          date: latestCheckInDate
        })
      : null;

    const latestWaterDoc = latestCheckInDate
      ? await healthMetricDaily.findOne({
          userId: targetUserId,
          isDeleted: false,
          metricType: 'water',
          date: latestCheckInDate
        })
      : null;

    if (!userDoc) {
      return res.status(404).json({
        message: 'User not found'
      });
    }

    const firstName =
      typeof (profileDoc as any)?.firstName === 'string'
        ? (profileDoc as any).firstName.trim()
        : '';
    const lastName =
      typeof (profileDoc as any)?.lastName === 'string'
        ? (profileDoc as any).lastName.trim()
        : '';

    const fullName =
      [firstName, lastName].filter(Boolean).join(' ') ||
      (typeof (userDoc as any)?.displayName === 'string'
        ? (userDoc as any).displayName.trim()
        : '') ||
      'Client';

    let assignedCoach: { coachId: string; fullName: string } | null = null;

    const coachId = (profileDoc as any)?.coachId;
    if (coachId instanceof ObjectId) {
      const [coachUserDoc, coachProfileDoc] = await Promise.all([
        users.findOne({ _id: coachId }),
        userProfiles.findOne({ userId: coachId })
      ]);

      if (coachUserDoc) {
        const coachFirstName =
          typeof (coachProfileDoc as any)?.firstName === 'string'
            ? (coachProfileDoc as any).firstName.trim()
            : '';
        const coachLastName =
          typeof (coachProfileDoc as any)?.lastName === 'string'
            ? (coachProfileDoc as any).lastName.trim()
            : '';

        const coachFullName =
          [coachFirstName, coachLastName].filter(Boolean).join(' ') ||
          (typeof (coachUserDoc as any)?.displayName === 'string'
            ? (coachUserDoc as any).displayName.trim()
            : '') ||
          'Coach';

        assignedCoach = {
          coachId: String(coachId),
          fullName: coachFullName
        };
      }
    }

    const weightKg =
      typeof (profileDoc as any)?.weightKg === 'number'
        ? (profileDoc as any).weightKg
        : null;

    const goalWeightKg =
      typeof (profileDoc as any)?.goalWeightKg === 'number'
        ? (profileDoc as any).goalWeightKg
        : null;

    const heightCm =
      typeof (profileDoc as any)?.heightCm === 'number'
        ? (profileDoc as any).heightCm
        : null;

    const waterTargetMl =
      typeof (profileDoc as any)?.waterGoalDailyMl === 'number'
        ? (profileDoc as any).waterGoalDailyMl
        : null;

    const latestWeightKg =
      typeof (latestCheckInDoc as any)?.metrics?.weightKg === 'number'
        ? (latestCheckInDoc as any).metrics.weightKg
        : null;

    const latestEnergy =
      typeof (latestCheckInDoc as any)?.sections?.daily?.recovery
        ?.energyLevel === 'number'
        ? (latestCheckInDoc as any).sections.daily.recovery.energyLevel
        : null;

    const latestOnTrackLevel =
      typeof (latestCheckInDoc as any)?.sections?.daily?.recovery
        ?.onTrackLevel === 'number'
        ? (latestCheckInDoc as any).sections.daily.recovery.onTrackLevel
        : null;

    const latestSteps =
      typeof (latestStepsDoc as any)?.value === 'number'
        ? (latestStepsDoc as any).value
        : null;

    const latestWaterMl =
      typeof (latestWaterDoc as any)?.value === 'number'
        ? (latestWaterDoc as any).value
        : null;

    const latestNotes =
      typeof (latestCheckInDoc as any)?.metrics?.notes === 'string'
        ? (latestCheckInDoc as any).metrics.notes
        : null;

    const weightTrendPoints = weightTrendDocs
      .map((doc) => {
        const recordedAt = (doc as any)?.recordedAt;
        const pointWeightKg = (doc as any)?.metrics?.weightKg;

        if (
          !(recordedAt instanceof Date) ||
          typeof pointWeightKg !== 'number'
        ) {
          return null;
        }

        return {
          date: recordedAt.toISOString(),
          weight: pointWeightKg
        };
      })
      .filter(Boolean);

    const startWeight =
      weightTrendPoints.length > 0
        ? weightTrendPoints[0]?.weight ?? null
        : null;

    const currentWeight =
      weightTrendPoints.length > 0
        ? weightTrendPoints[weightTrendPoints.length - 1]?.weight ?? null
        : null;

    const change =
      startWeight != null && currentWeight != null
        ? Number((currentWeight - startWeight).toFixed(1))
        : null;

    const changeDirection =
      change == null ? null : change < 0 ? 'down' : change > 0 ? 'up' : 'flat';

    let latestPhotoSet: {
      photoSetId: string;
      capturedAt: string;
      photos: {
        front?: { url: string; thumbnailUrl?: string | null } | null;
        side?: { url: string; thumbnailUrl?: string | null } | null;
        back?: { url: string; thumbnailUrl?: string | null } | null;
      };
    } | null = null;

    if (
      latestProgressPhotoSetDoc &&
      Array.isArray((latestProgressPhotoSetDoc as any).photos)
    ) {
      const photos = (latestProgressPhotoSetDoc as any).photos as any[];

      const mappedPhotos = await Promise.all(
        photos.map(async (photo) => {
          const url = await createSignedPhotoViewUrl({
            storageKey: photo.storageKey
          });

          return {
            position: photo.position as 'front' | 'side' | 'back',
            url
          };
        })
      );

      const capturedAt =
        toIsoOrNull((latestProgressPhotoSetDoc as any).attachedAt) ??
        toIsoOrNull((latestProgressPhotoSetDoc as any).finalizedAt) ??
        toIsoOrNull((latestProgressPhotoSetDoc as any).createdAt) ??
        new Date().toISOString();

      latestPhotoSet = {
        photoSetId: String((latestProgressPhotoSetDoc as any)._id),
        capturedAt,
        photos: {
          front: mappedPhotos.find((p) => p.position === 'front')
            ? {
                url: mappedPhotos.find((p) => p.position === 'front')!.url,
                thumbnailUrl: mappedPhotos.find((p) => p.position === 'front')!
                  .url
              }
            : null,
          side: mappedPhotos.find((p) => p.position === 'side')
            ? {
                url: mappedPhotos.find((p) => p.position === 'side')!.url,
                thumbnailUrl: mappedPhotos.find((p) => p.position === 'side')!
                  .url
              }
            : null,
          back: mappedPhotos.find((p) => p.position === 'back')
            ? {
                url: mappedPhotos.find((p) => p.position === 'back')!.url,
                thumbnailUrl: mappedPhotos.find((p) => p.position === 'back')!
                  .url
              }
            : null
        }
      };
    }

    const checkInHistory = checkInHistoryDocs.map((doc: any) => ({
      _id: String(doc._id),
      userId: String(doc.userId),
      recordedAt: doc.recordedAt?.toISOString?.() ?? null,
      metrics: {
        weightKg: doc.metrics?.weightKg ?? null,
        notes: doc.metrics?.notes ?? null
      },
      hasPhotos: Boolean(doc.hasPhotos),
      photos: doc.photos ?? null,
      createdAt: doc.createdAt?.toISOString?.() ?? null,
      createdByUserId: String(doc.createdByUserId),
      isDeleted: Boolean(doc.isDeleted),
      source: doc.source ?? null
    }));

    return res.status(200).json({
      overview: {
        clientId: String((userDoc as any)._id),
        userId: String((userDoc as any)._id),
        firstName: firstName || null,
        lastName: lastName || null,
        fullName,
        email: (userDoc as any).email ?? null,
        profilePhotoUrl: null,
        role: 'client',
        status: (userDoc as any).status ?? 'active',
        assignedCoach,
        joinedAt: toIsoOrNull((userDoc as any).createdAt),
        age: (profileDoc as any)?.age ?? null,
        heightCm,
        heightDisplay: toDisplayHeight(heightCm),
        currentWeightKg: weightKg,
        currentWeightDisplay: toDisplayWeight(weightKg),
        goalWeightKg,
        goalWeightDisplay: toDisplayWeight(goalWeightKg),
        bodyFatPercent: null,
        goalType: (profileDoc as any)?.goal ?? null,
        membershipService: null
      },

      nutrition: {
        calorieTarget: (nutritionDoc as any)?.targets?.calories ?? null,
        macros: {
          proteinGrams: (nutritionDoc as any)?.targets?.protein ?? null,
          carbsGrams: (nutritionDoc as any)?.targets?.carbs ?? null,
          fatGrams: (nutritionDoc as any)?.targets?.fats ?? null
        },
        waterTargetMl,
        fiberTargetGrams: null,
        mealPlanStyle: (nutritionDoc as any)?.preferences?.dietStyle ?? null,
        phase: (profileDoc as any)?.goal ?? null,
        calculatedFrom: {
          goalType: (profileDoc as any)?.goal ?? null,
          activityLevel: (profileDoc as any)?.activityLevel ?? null,
          weeklyGoalRate: null
        },
        lastUpdatedAt: toIsoOrNull((nutritionDoc as any)?.updatedAt)
      },

      notes: {
        currentNote: '',
        updatedAt: null,
        updatedBy: null
      },

      weightTrend: {
        unit: 'kg',
        points: weightTrendPoints,
        summary: {
          startWeight,
          currentWeight,
          change,
          changeDirection,
          periodLabel: weightTrendPoints.length > 0 ? 'All time' : null
        }
      },

      latestCheckIn: latestCheckInDoc
        ? {
            checkInId: String((latestCheckInDoc as any)._id),
            recordedAt: toIsoOrNull((latestCheckInDoc as any).recordedAt),
            weightKg: latestWeightKg,
            weightDisplay: toDisplayWeight(latestWeightKg),
            bodyFatPercent: null,
            waistCm: null,
            waistDisplay: null,
            waterMl: latestWaterMl,
            energy: latestEnergy,
            onTrackLevel: latestOnTrackLevel,
            sleepHours: null,
            steps: latestSteps,
            workoutCount: null,
            adherence: null,
            notes: latestNotes,
            hasPhotos: Boolean((latestCheckInDoc as any)?.hasPhotos)
          }
        : null,

      checkInHistory,

      activity: {
        period: '7d',
        averageSteps: null,
        averageSleepHours: null,
        workoutsCompleted: null,
        workoutsScheduled: null,
        cardioMinutes: null,
        strengthSessions: null,
        adherenceScore: null,
        streaks: {
          checkInStreakDays: null,
          workoutStreakDays: null
        }
      },

      insights: {
        status: 'insufficient_data',
        highlights: [],
        flags: [],
        metrics: null,
        generatedAt: null
      },

      photos: {
        latestSet: latestPhotoSet,
        totalSets: progressPhotoSetCount
      }
    });
  }
);
