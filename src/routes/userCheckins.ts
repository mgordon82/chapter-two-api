import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';
import { createSignedPhotoViewUrl } from '../utils/r2Uploads';
import { mapCheckIn, mapCheckIns } from '../utils/checkInMapper';
import { getDayPeriod, parseLocalDateInput } from '../utils/periods';
import { getOrCreateDailyCheckIn } from '../services/checkIns/getOrCreateDailyCheckIn';
import { mapExerciseSessions } from '../utils/exerciseSessionMapper';
import { getCurrentActor } from '../utils/getCurrentActor';

export const checkInsRouter = Router();

async function hydrateCheckInPhotos(item: any) {
  if (!item?.hasPhotos || !item?.photos?.photos?.length) {
    return item;
  }

  const photosWithViewUrls = await Promise.all(
    item.photos.photos.map(async (photo: any) => {
      const viewUrl = await createSignedPhotoViewUrl({
        storageKey: photo.storageKey
      });

      return {
        position: photo.position,
        storageKey: photo.storageKey,
        mimeType: photo.mimeType,
        originalFileName: photo.originalFileName ?? null,
        sizeBytes: photo.sizeBytes ?? null,
        uploadedAt:
          photo.uploadedAt instanceof Date
            ? photo.uploadedAt.toISOString()
            : photo.uploadedAt,
        viewUrl
      };
    })
  );

  return {
    ...item,
    photos: {
      photos: photosWithViewUrls
    }
  };
}

checkInsRouter.get('/current-user', requireCognitoAuth, async (req, res) => {
  try {
    const sub = req.cognito?.sub;
    if (!sub) return res.status(401).json({ message: 'Missing Cognito sub' });

    const db = getDb();
    const checkIns = db.collection('checkIns');

    const { actor, error } = await getCurrentActor({
      db,
      cognitoSub: sub
    });

    if (error || !actor) {
      return res.status(error?.status ?? 401).json({
        message: error?.message ?? 'User not found for this token'
      });
    }

    const rangeRaw =
      typeof req.query.range === 'string' ? req.query.range.trim() : '3M';

    const end = new Date();
    const start = new Date(end);

    switch (rangeRaw) {
      case '1W':
        start.setDate(start.getDate() - 7);
        break;
      case '1M':
        start.setMonth(start.getMonth() - 1);
        break;
      case '3M':
        start.setMonth(start.getMonth() - 3);
        break;
      case '6M':
        start.setMonth(start.getMonth() - 6);
        break;
      case '12M':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        return res.status(400).json({ message: 'Invalid range' });
    }

    const rawItems = await checkIns
      .find({
        userId: actor._id,
        isDeleted: false,
        recordedAt: {
          $gte: start,
          $lte: end
        }
      })
      .sort({ recordedAt: -1 })
      .toArray();

    const items = await Promise.all(
      rawItems.map((item) => hydrateCheckInPhotos(item))
    );
    const mappedItems = mapCheckIns(items);

    return res.json({
      ok: true,
      items,
      mappedItems
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch check-ins' });
  }
});

checkInsRouter.post('/current-user', requireCognitoAuth, async (req, res) => {
  const sub = req.cognito?.sub;

  try {
    if (!sub) {
      return res.status(401).json({ message: 'Missing Cognito sub' });
    }

    const db = getDb();
    const checkIns = db.collection('checkIns');
    const userProfiles = db.collection('userProfiles');
    const photoSets = db.collection('photoSets');

    const { actor, error } = await getCurrentActor({
      db,
      cognitoSub: sub
    });

    if (error || !actor) {
      return res.status(error?.status ?? 401).json({
        message: error?.message ?? 'User not found for this token'
      });
    }

    const {
      representedDate,
      recordedAt,
      weightKg,
      notes,
      progressPhotoSetId,
      energyLevel,
      onTrackLevel,
      calories,
      proteinGrams,
      restingHeartRate,
      steps,
      totalExerciseMinutes,
      standGoal
    } = req.body ?? {};

    if (
      typeof representedDate !== 'string' ||
      representedDate.trim().length === 0
    ) {
      return res.status(400).json({
        message: 'representedDate is required'
      });
    }

    const targetDay = parseLocalDateInput(representedDate);

    if (Number.isNaN(targetDay.getTime())) {
      console.warn(
        '[checkIns/create] validation failed: invalid representedDate',
        {
          sub,
          userId: actor._id.toString(),
          representedDate
        }
      );

      return res.status(400).json({
        message: 'representedDate must be a valid YYYY-MM-DD date string'
      });
    }

    const rAt = recordedAt ? new Date(recordedAt) : new Date();
    if (Number.isNaN(rAt.getTime())) {
      console.warn('[checkIns/create] validation failed: invalid recordedAt', {
        sub,
        userId: actor._id.toString(),
        recordedAt
      });

      return res
        .status(400)
        .json({ message: 'recordedAt must be a valid ISO date string' });
    }

    const hasWeightInput =
      weightKg !== undefined &&
      weightKg !== null &&
      String(weightKg).trim() !== '';

    let parsedWeightKg: number | null = null;
    if (hasWeightInput) {
      const w = Number(weightKg);
      if (!Number.isFinite(w) || w < 20 || w > 300) {
        console.warn('[checkIns/create] validation failed: invalid weightKg', {
          sub,
          userId: actor._id.toString(),
          weightKg
        });

        return res
          .status(400)
          .json({ message: 'weightKg must be a number between 20 and 300' });
      }
      parsedWeightKg = w;
    }

    let parsedEnergyLevel: number | null = null;
    if (
      energyLevel !== undefined &&
      energyLevel !== null &&
      String(energyLevel).trim() !== ''
    ) {
      const e = Number(energyLevel);
      if (!Number.isFinite(e) || e < 1 || e > 10) {
        return res.status(400).json({
          message: 'energyLevel must be a number between 1 and 10'
        });
      }
      parsedEnergyLevel = e;
    }

    let parsedOnTrackLevel: number | null = null;
    if (
      onTrackLevel !== undefined &&
      onTrackLevel !== null &&
      String(onTrackLevel).trim() !== ''
    ) {
      const otl = Number(onTrackLevel);
      if (!Number.isFinite(otl) || otl < 1 || otl > 10) {
        return res.status(400).json({
          message: 'onTrackLevel must be a number between 1 and 10'
        });
      }
      parsedOnTrackLevel = otl;
    }

    let parsedCalories: number | null = null;
    if (
      calories !== undefined &&
      calories !== null &&
      String(calories).trim() !== ''
    ) {
      const c = Number(calories);
      if (!Number.isFinite(c) || c < 0) {
        return res.status(400).json({
          message: 'calories must be a non-negative number'
        });
      }
      parsedCalories = c;
    }

    let parsedProteinGrams: number | null = null;
    if (
      proteinGrams !== undefined &&
      proteinGrams !== null &&
      String(proteinGrams).trim() !== ''
    ) {
      const p = Number(proteinGrams);
      if (!Number.isFinite(p) || p < 0) {
        return res.status(400).json({
          message: 'proteinGrams must be a non-negative number'
        });
      }
      parsedProteinGrams = p;
    }

    let parsedRestingHeartRate: number | null = null;
    if (
      restingHeartRate !== undefined &&
      restingHeartRate !== null &&
      String(restingHeartRate).trim() !== ''
    ) {
      const rhr = Number(restingHeartRate);
      if (!Number.isFinite(rhr) || rhr < 0) {
        return res.status(400).json({
          message: 'restingHeartRate must be a non-negative number'
        });
      }
      parsedRestingHeartRate = rhr;
    }

    let parsedSteps: number | null = null;
    if (steps !== undefined && steps !== null && String(steps).trim() !== '') {
      const s = Number(steps);
      if (!Number.isFinite(s) || s < 0) {
        return res.status(400).json({
          message: 'steps must be a non-negative number'
        });
      }
      parsedSteps = s;
    }

    let parsedTotalExerciseMinutes: number | null = null;
    if (
      totalExerciseMinutes !== undefined &&
      totalExerciseMinutes !== null &&
      String(totalExerciseMinutes).trim() !== ''
    ) {
      const tem = Number(totalExerciseMinutes);
      if (!Number.isFinite(tem) || tem < 0) {
        return res.status(400).json({
          message: 'totalExerciseMinutes must be a non-negative number'
        });
      }
      parsedTotalExerciseMinutes = tem;
    }

    let parsedStandGoal: number | null = null;
    if (
      standGoal !== undefined &&
      standGoal !== null &&
      String(standGoal).trim() !== ''
    ) {
      const sg = Number(standGoal);
      if (!Number.isFinite(sg) || sg < 0) {
        return res.status(400).json({
          message: 'standGoal must be a non-negative number'
        });
      }
      parsedStandGoal = sg;
    }

    let finalizedProgressPhotoSet: any = null;

    if (progressPhotoSetId != null) {
      if (
        typeof progressPhotoSetId !== 'string' ||
        !ObjectId.isValid(progressPhotoSetId)
      ) {
        return res.status(400).json({
          message: 'progressPhotoSetId must be a valid ObjectId string'
        });
      }

      finalizedProgressPhotoSet = await photoSets.findOne({
        _id: new ObjectId(progressPhotoSetId),
        userId: actor._id,
        type: 'progress',
        isDeleted: false
      });

      if (!finalizedProgressPhotoSet) {
        console.warn('[checkIns/create] progress photo set not found', {
          sub,
          userId: actor._id.toString(),
          progressPhotoSetId
        });

        return res.status(404).json({
          message: 'Progress photo set not found'
        });
      }

      if (finalizedProgressPhotoSet.status !== 'finalized') {
        console.warn('[checkIns/create] progress photo set not finalized', {
          sub,
          userId: actor._id.toString(),
          progressPhotoSetId,
          status: finalizedProgressPhotoSet.status
        });

        return res.status(409).json({
          message:
            'Progress photo set must be finalized before creating check-in'
        });
      }

      if (
        !Array.isArray(finalizedProgressPhotoSet.photos) ||
        finalizedProgressPhotoSet.photos.length === 0
      ) {
        console.warn('[checkIns/create] progress photo set missing photos', {
          sub,
          userId: actor._id.toString(),
          progressPhotoSetId
        });

        return res.status(409).json({
          message: 'Progress photo set has no finalized photos'
        });
      }
    }

    const now = new Date();

    const { checkIn, created } = await getOrCreateDailyCheckIn({
      db,
      userId: actor._id,
      targetDate: targetDay
    });

    const isClosed = checkIn?.status === 'closed';

    const editWindowEnded =
      checkIn?.manualEditWindowEndsAt &&
      new Date() > new Date(checkIn.manualEditWindowEndsAt);

    if (!created && (isClosed || editWindowEnded)) {
      return res.status(409).json({
        message: isClosed
          ? 'Check-in is closed and must be reopened before editing'
          : 'Check-in edit window has ended and must be reopened before editing',
        status: isClosed ? 'closed' : 'expired',
        item: checkIn,
        mappedItem: mapCheckIn(checkIn)
      });
    }

    const updateSet: Record<string, unknown> = {
      updatedAt: now,
      updatedByUserId: actor._id,
      recordedAt: rAt,
      hasPhotos: Boolean(finalizedProgressPhotoSet)
    };

    if (parsedWeightKg !== null) {
      updateSet['metrics.weightKg'] = parsedWeightKg;
      updateSet['sections.daily.body.weightKg.overrideValue'] = parsedWeightKg;
    }

    if (parsedEnergyLevel !== null) {
      updateSet['sections.daily.recovery.energyLevel'] = parsedEnergyLevel;
    }

    if (parsedOnTrackLevel !== null) {
      updateSet['sections.daily.recovery.onTrackLevel'] = parsedOnTrackLevel;
    }

    if (parsedCalories !== null) {
      updateSet['sections.daily.nutrition.calories.value'] = parsedCalories;
      updateSet['sections.daily.nutrition.calories.updatedAt'] = now;
    }

    if (parsedProteinGrams !== null) {
      updateSet['sections.daily.nutrition.proteinGrams.value'] =
        parsedProteinGrams;
      updateSet['sections.daily.nutrition.proteinGrams.updatedAt'] = now;
    }

    if (parsedRestingHeartRate !== null) {
      updateSet['sections.daily.recovery.restingHeartRate.overrideValue'] =
        parsedRestingHeartRate;
    }

    if (parsedSteps !== null) {
      updateSet['sections.daily.activity.steps.overrideValue'] = parsedSteps;
    }

    if (parsedTotalExerciseMinutes !== null) {
      updateSet['sections.daily.activity.totalExerciseMinutes.overrideValue'] =
        parsedTotalExerciseMinutes;
    }

    if (parsedStandGoal !== null) {
      updateSet['sections.daily.activity.standGoal.overrideValue'] =
        parsedStandGoal;
    }

    if (typeof notes === 'string') {
      updateSet['metrics.notes'] = notes;
      updateSet['sections.daily.notes.userNotes'] = notes;
    }

    if (finalizedProgressPhotoSet) {
      updateSet.photos = {
        photos: finalizedProgressPhotoSet.photos
      };
      updateSet['sections.daily.photos.photoSetId'] =
        finalizedProgressPhotoSet._id;
    }

    await checkIns.updateOne(
      { _id: checkIn._id, userId: actor._id, isDeleted: false },
      { $set: updateSet }
    );

    if (parsedWeightKg !== null) {
      const profileUpdate = await userProfiles.updateOne(
        { userId: actor._id },
        {
          $set: {
            weightKg: parsedWeightKg,
            updatedAt: now
          }
        }
      );

      if (profileUpdate.matchedCount === 0) {
        console.warn('[checkIns/create] no userProfile found', {
          userId: actor._id.toString()
        });
      }
    }

    if (finalizedProgressPhotoSet) {
      await photoSets.updateOne(
        {
          _id: finalizedProgressPhotoSet._id,
          userId: actor._id,
          type: 'progress',
          isDeleted: false
        },
        {
          $set: {
            checkInId: checkIn._id,
            status: 'attached',
            attachedAt: now,
            updatedAt: now
          }
        }
      );
    }

    const savedCheckIn = await checkIns.findOne({
      _id: checkIn._id,
      userId: actor._id,
      isDeleted: false
    });

    const mappedItem = savedCheckIn ? mapCheckIn(savedCheckIn) : null;

    return res.status(created ? 201 : 200).json({
      ok: true,
      action: created ? 'created' : 'updated',
      id: checkIn._id.toString(),
      item: savedCheckIn,
      mappedItem,
      lifecycleState: mappedItem?.lifecycleState ?? null,
      isEditable: mappedItem?.isEditable ?? false
    });
  } catch (err) {
    console.error('[checkIns/create] failed', {
      sub: sub ?? null,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });

    return res.status(500).json({ message: 'Failed to create check-in' });
  }
});

checkInsRouter.get(
  '/current-user/by-date',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const dateParam =
        typeof req.query.date === 'string' ? req.query.date.trim() : '';

      if (!dateParam) {
        return res.status(400).json({ message: 'date is required' });
      }

      const targetDate = parseLocalDateInput(dateParam);

      if (Number.isNaN(targetDate.getTime())) {
        return res
          .status(400)
          .json({ message: 'date must be a valid ISO date string' });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const exerciseSessions = db.collection('exerciseSessions');

      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      const { periodKey } = getDayPeriod(targetDate);

      const suggestedExerciseSessions = await exerciseSessions
        .find({
          userId: actor._id,
          localDateKey: periodKey,
          isDeleted: false
        })
        .sort({ performedAt: 1, createdAt: 1 })
        .toArray();

      const mappedSuggestedExerciseSessions = mapExerciseSessions(
        suggestedExerciseSessions
      );

      const suggestedExerciseSessionIds = suggestedExerciseSessions.map(
        (session) => session._id
      );

      const item = await checkIns.findOne({
        userId: actor._id,
        periodType: 'day',
        periodKey,
        isDeleted: false
      });

      let workingItem = item;

      if (workingItem) {
        const hasExerciseSection =
          workingItem?.sections?.daily?.exercise &&
          typeof workingItem.sections.daily.exercise === 'object';

        const hasSuggestedIds = Array.isArray(
          workingItem?.sections?.daily?.exercise
            ?.autoSuggestedExerciseSessionIds
        );

        const hasIncludedIds = Array.isArray(
          workingItem?.sections?.daily?.exercise?.includedExerciseSessionIds
        );

        const hasExcludedIds = Array.isArray(
          workingItem?.sections?.daily?.exercise?.excludedExerciseSessionIds
        );

        if (
          !hasExerciseSection ||
          !hasSuggestedIds ||
          !hasIncludedIds ||
          !hasExcludedIds
        ) {
          await checkIns.updateOne(
            {
              _id: workingItem._id,
              userId: actor._id,
              isDeleted: false
            },
            {
              $set: {
                'sections.daily.exercise.autoSuggestedExerciseSessionIds':
                  suggestedExerciseSessionIds,
                'sections.daily.exercise.includedExerciseSessionIds':
                  suggestedExerciseSessionIds,
                'sections.daily.exercise.excludedExerciseSessionIds': [],
                updatedAt: new Date(),
                updatedByUserId: actor._id
              }
            }
          );

          workingItem = await checkIns.findOne({
            _id: workingItem._id,
            userId: actor._id,
            isDeleted: false
          });
        }
      }

      if (!workingItem) {
        return res.json({
          ok: true,
          item: null,
          mappedItem: null,
          suggestedExerciseSessions,
          mappedSuggestedExerciseSessions
        });
      }

      const hydratedItem = await hydrateCheckInPhotos(workingItem);

      return res.json({
        ok: true,
        item: hydratedItem,
        mappedItem: mapCheckIn(hydratedItem),
        suggestedExerciseSessions,
        mappedSuggestedExerciseSessions
      });
    } catch (err) {
      return res
        .status(500)
        .json({ message: 'Failed to fetch check-in by date' });
    }
  }
);

checkInsRouter.post(
  '/current-user/:id/close',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const idParam = req.params?.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) {
        return res.status(400).json({ message: 'Missing id' });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
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
            status: 'closed',
            closedAt: now,
            closedByUserId: actor._id,
            updatedAt: now,
            updatedByUserId: actor._id
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      const item = await checkIns.findOne({
        _id: new ObjectId(id),
        userId: actor._id,
        isDeleted: false
      });

      return res.json({
        ok: true,
        status: 'closed',
        item,
        mappedItem: item ? mapCheckIn(item) : null
      });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to close check-in' });
    }
  }
);

checkInsRouter.post(
  '/current-user/:id/reopen',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const idParam = req.params?.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) {
        return res.status(400).json({ message: 'Missing id' });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
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
            status: 'open',
            closedAt: null,
            closedByUserId: null,
            updatedAt: now,
            updatedByUserId: actor._id
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      const item = await checkIns.findOne({
        _id: new ObjectId(id),
        userId: actor._id,
        isDeleted: false
      });

      return res.json({
        ok: true,
        status: 'open',
        item,
        mappedItem: item ? mapCheckIn(item) : null
      });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to reopen check-in' });
    }
  }
);

checkInsRouter.post(
  '/current-user/:id/exercise-selection',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const idParam = req.params?.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) {
        return res.status(400).json({ message: 'Missing id' });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }

      const {
        autoSuggestedExerciseSessionIds,
        includedExerciseSessionIds,
        excludedExerciseSessionIds
      } = req.body ?? {};

      if (!Array.isArray(autoSuggestedExerciseSessionIds)) {
        return res.status(400).json({
          message: 'autoSuggestedExerciseSessionIds must be an array'
        });
      }

      if (!Array.isArray(includedExerciseSessionIds)) {
        return res.status(400).json({
          message: 'includedExerciseSessionIds must be an array'
        });
      }

      if (!Array.isArray(excludedExerciseSessionIds)) {
        return res.status(400).json({
          message: 'excludedExerciseSessionIds must be an array'
        });
      }

      const normalizeIds = (values: unknown[]) => {
        const ids: ObjectId[] = [];

        for (const value of values) {
          if (typeof value !== 'string' || !ObjectId.isValid(value)) {
            return null;
          }
          ids.push(new ObjectId(value));
        }

        return ids;
      };

      const suggestedIds = normalizeIds(autoSuggestedExerciseSessionIds);
      const includedIds = normalizeIds(includedExerciseSessionIds);
      const excludedIds = normalizeIds(excludedExerciseSessionIds);

      if (!suggestedIds || !includedIds || !excludedIds) {
        return res.status(400).json({
          message: 'All exercise session IDs must be valid ObjectId strings'
        });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      const item = await checkIns.findOne({
        _id: new ObjectId(id),
        userId: actor._id,
        isDeleted: false
      });

      if (!item) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      const isClosed = item?.status === 'closed';
      const editWindowEnded =
        item?.manualEditWindowEndsAt &&
        new Date() > new Date(item.manualEditWindowEndsAt);

      if (isClosed || editWindowEnded) {
        return res.status(409).json({
          message: isClosed
            ? 'Check-in is closed and must be reopened before editing exercise selection'
            : 'Check-in edit window has ended and must be reopened before editing exercise selection',
          status: isClosed ? 'closed' : 'expired',
          item,
          mappedItem: mapCheckIn(item)
        });
      }

      const now = new Date();

      await checkIns.updateOne(
        {
          _id: item._id,
          userId: actor._id,
          isDeleted: false
        },
        {
          $set: {
            'sections.daily.exercise.autoSuggestedExerciseSessionIds':
              suggestedIds,
            'sections.daily.exercise.includedExerciseSessionIds': includedIds,
            'sections.daily.exercise.excludedExerciseSessionIds': excludedIds,
            updatedAt: now,
            updatedByUserId: actor._id
          }
        }
      );

      const savedItem = await checkIns.findOne({
        _id: item._id,
        userId: actor._id,
        isDeleted: false
      });

      return res.json({
        ok: true,
        item: savedItem,
        mappedItem: savedItem ? mapCheckIn(savedItem) : null
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to update exercise selection'
      });
    }
  }
);

checkInsRouter.post(
  '/current-user/:id/coach-feedback',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const idParam = req.params?.id;
      const id = Array.isArray(idParam) ? idParam[0] : idParam;

      if (!id) {
        return res.status(400).json({ message: 'Missing id' });
      }

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }

      const { feedback, visibleToUser } = req.body ?? {};

      if (typeof feedback !== 'string' || feedback.trim().length === 0) {
        return res.status(400).json({
          message: 'feedback is required'
        });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      const item = await checkIns.findOne({
        _id: new ObjectId(id),
        isDeleted: false
      });

      if (!item) {
        return res.status(404).json({ message: 'Check-in not found' });
      }

      const now = new Date();
      const hadExistingFeedback =
        item?.coachFeedback &&
        typeof item.coachFeedback === 'object' &&
        typeof item.coachFeedback.feedback === 'string';

      await checkIns.updateOne(
        {
          _id: item._id,
          isDeleted: false
        },
        {
          $set: {
            coachFeedback: {
              coachUserId: actor._id,
              feedback: feedback.trim(),
              createdAt: hadExistingFeedback
                ? item.coachFeedback.createdAt ?? now
                : now,
              updatedAt: hadExistingFeedback ? now : null,
              visibleToUser:
                typeof visibleToUser === 'boolean' ? visibleToUser : true
            },
            updatedAt: now,
            updatedByUserId: actor._id
          }
        }
      );

      const savedItem = await checkIns.findOne({
        _id: item._id,
        isDeleted: false
      });

      return res.json({
        ok: true,
        item: savedItem,
        mappedItem: savedItem ? mapCheckIn(savedItem) : null
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to save coach feedback'
      });
    }
  }
);

checkInsRouter.delete(
  '/current-user/:id',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) return res.status(401).json({ message: 'Missing Cognito sub' });

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

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

checkInsRouter.post(
  '/current-user/import/apple-health/weight',
  requireCognitoAuth,
  async (req, res) => {
    const sub = req.cognito?.sub;

    try {
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const checkIns = db.collection('checkIns');
      const userProfiles = db.collection('userProfiles');
      const userIntegrations = db.collection('userIntegrations');

      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      await userIntegrations.updateOne(
        {
          userId: actor._id,
          integration: 'apple_health'
        },
        {
          $setOnInsert: {
            userId: actor._id,
            integration: 'apple_health',
            platform: 'ios',
            status: 'connected',
            createdAt: new Date()
          },
          $set: {
            updatedAt: new Date(),
            'permissions.weight': true
          }
        },
        { upsert: true }
      );

      const { externalSampleId, recordedAt, metrics, source } = req.body ?? {};

      if (
        typeof externalSampleId !== 'string' ||
        externalSampleId.trim().length === 0
      ) {
        return res.status(400).json({
          message: 'externalSampleId is required'
        });
      }

      const rAt = new Date(recordedAt);
      if (!recordedAt || Number.isNaN(rAt.getTime())) {
        return res.status(400).json({
          message: 'recordedAt must be a valid ISO date string'
        });
      }

      const weightKg = Number(metrics?.weightKg);
      if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
        return res.status(400).json({
          message: 'metrics.weightKg must be a number between 20 and 300'
        });
      }

      const appSourceName =
        typeof source?.appSourceName === 'string' ? source.appSourceName : null;

      const deviceSourceName =
        typeof source?.deviceSourceName === 'string'
          ? source.deviceSourceName
          : null;

      const existingImported = await checkIns.findOne({
        userId: actor._id,
        isDeleted: false,
        'sections.daily.body.weightKg.appleHealth.externalSampleId':
          externalSampleId
      });
      const now = new Date();

      if (existingImported) {
        await userIntegrations.updateOne(
          {
            userId: actor._id,
            integration: 'apple_health'
          },
          {
            $set: {
              updatedAt: now,
              'lastSync.weightImportedAt': now
            },
            $max: {
              'lastSync.weightRecordedAt': rAt
            }
          }
        );

        return res.status(200).json({
          ok: true,
          status: 'duplicate',
          id: existingImported._id.toString()
        });
      }

      const dailyCheckInResult = await getOrCreateDailyCheckIn({
        db,
        userId: actor._id,
        targetDate: rAt
      });

      const dailyCheckIn = dailyCheckInResult.checkIn;
      const insertedCheckInId = dailyCheckIn._id;

      const existingEffectiveWeight =
        dailyCheckIn?.sections?.daily?.body?.weightKg?.overrideValue ??
        dailyCheckIn?.metrics?.weightKg ??
        null;

      const shouldApplyImportedWeightAsEffective =
        existingEffectiveWeight == null;

      await checkIns.updateOne(
        {
          _id: dailyCheckIn._id,
          userId: actor._id,
          isDeleted: false
        },
        {
          $set: {
            updatedAt: now,
            updatedByUserId: actor._id,

            'sections.daily.body.weightKg.appleHealth': {
              value: weightKg,
              recordedAt: rAt,
              appSourceName,
              deviceSourceName,
              externalSampleId,
              importedAt: now
            },

            ...(shouldApplyImportedWeightAsEffective
              ? {
                  'metrics.weightKg': weightKg,
                  'sections.daily.body.weightKg.overrideValue': weightKg,
                  recordedAt: rAt
                }
              : {})
          }
        }
      );

      await userIntegrations.updateOne(
        {
          userId: actor._id,
          integration: 'apple_health'
        },
        {
          $set: {
            updatedAt: now,
            'lastSync.weightImportedAt': now
          },
          $max: {
            'lastSync.weightRecordedAt': rAt
          }
        }
      );

      const existingProfile = await userProfiles.findOne({ userId: actor._id });

      const existingProfileWeightRecordedAt =
        existingProfile?.weightRecordedAt instanceof Date
          ? existingProfile.weightRecordedAt
          : null;

      const shouldUpdateProfileWeight =
        shouldApplyImportedWeightAsEffective &&
        (!existingProfileWeightRecordedAt ||
          rAt.getTime() >= existingProfileWeightRecordedAt.getTime());

      if (shouldUpdateProfileWeight) {
        await userProfiles.updateOne(
          { userId: actor._id },
          {
            $set: {
              weightKg,
              weightRecordedAt: rAt,
              updatedAt: now
            }
          }
        );
      }

      return res.status(201).json({
        ok: true,
        status: 'created',
        id: insertedCheckInId.toString()
      });
    } catch (err) {
      console.error('[checkIns/importAppleHealthWeight] failed', {
        sub: sub ?? null,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });

      return res.status(500).json({
        message: 'Failed to import Apple Health weight'
      });
    }
  }
);

checkInsRouter.get(
  '/current-user/integrations/apple-health',
  requireCognitoAuth,
  async (req, res) => {
    const sub = req.cognito?.sub;

    try {
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const userIntegrations = db.collection('userIntegrations');

      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      const integration = await userIntegrations.findOne({
        userId: actor._id,
        integration: 'apple_health'
      });

      return res.json({
        ok: true,
        integration: integration
          ? {
              status: integration.status ?? null,
              platform: integration.platform ?? null,
              permissions: integration.permissions ?? {},
              lastSync: integration.lastSync ?? null,
              updatedAt: integration.updatedAt ?? null
            }
          : null
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to fetch Apple Health integration'
      });
    }
  }
);
