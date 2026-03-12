import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';
import { createSignedPhotoViewUrl } from '../utils/r2Uploads';

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

    const rawItems = await checkIns
      .find({ userId: actor._id, isDeleted: false })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .toArray();

    const items = await Promise.all(
      rawItems.map(async (item) => {
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
      })
    );

    return res.json({ ok: true, items });
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
    const users = db.collection('users');
    const checkIns = db.collection('checkIns');
    const userProfiles = db.collection('userProfiles');
    const photoSets = db.collection('photoSets');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });
    if (!actor) {
      return res.status(401).json({ message: 'User not found for this token' });
    }

    const { recordedAt, weightKg, notes, progressPhotoSetId } = req.body ?? {};

    console.info('[checkIns/create] start', {
      sub,
      userId: actor._id.toString(),
      hasProgressPhotoSetId: Boolean(progressPhotoSetId),
      progressPhotoSetId:
        typeof progressPhotoSetId === 'string' ? progressPhotoSetId : null
    });

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

    const doc = {
      userId: actor._id,
      recordedAt: rAt,
      metrics: {
        weightKg: w,
        notes: typeof notes === 'string' ? notes : ''
      },
      hasPhotos: Boolean(finalizedProgressPhotoSet),
      photos: finalizedProgressPhotoSet
        ? {
            photos: finalizedProgressPhotoSet.photos
          }
        : undefined,
      createdAt: now,
      createdByUserId: actor._id,
      updatedAt: null,
      isDeleted: false
    };

    const result = await checkIns.insertOne(doc);
    const insertedCheckInId = result.insertedId;

    console.info('[checkIns/create] check-in inserted', {
      sub,
      userId: actor._id.toString(),
      checkInId: insertedCheckInId.toString(),
      hasPhotos: Boolean(finalizedProgressPhotoSet)
    });

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
      console.warn('[checkIns/create] no userProfile found', {
        userId: actor._id.toString()
      });
    }

    if (finalizedProgressPhotoSet) {
      await photoSets.updateOne(
        {
          _id: new ObjectId(progressPhotoSetId),
          userId: actor._id,
          type: 'progress',
          isDeleted: false
        },
        {
          $set: {
            checkInId: insertedCheckInId,
            status: 'attached',
            attachedAt: now,
            updatedAt: now
          }
        }
      );

      console.info('[checkIns/create] progress photo set attached', {
        sub,
        userId: actor._id.toString(),
        progressPhotoSetId,
        checkInId: insertedCheckInId.toString()
      });
    }

    return res.status(201).json({
      ok: true,
      id: insertedCheckInId.toString()
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
      const users = db.collection('users');
      const checkIns = db.collection('checkIns');
      const userProfiles = db.collection('userProfiles');
      const userIntegrations = db.collection('userIntegrations');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
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
            permissions: {
              weight: true
            },
            createdAt: new Date()
          },
          $set: {
            updatedAt: new Date()
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
        'source.type': 'apple_health',
        'source.integration': 'apple_health',
        'source.externalSampleId': externalSampleId
      });

      if (existingImported) {
        return res.status(200).json({
          ok: true,
          status: 'duplicate',
          id: existingImported._id.toString()
        });
      }

      const existingAtSameRecordedAt = await checkIns.findOne({
        userId: actor._id,
        isDeleted: false,
        recordedAt: rAt
      });

      if (existingAtSameRecordedAt) {
        return res.status(200).json({
          ok: true,
          status: 'conflict_existing_checkin',
          existingCheckInId: existingAtSameRecordedAt._id.toString()
        });
      }

      const now = new Date();

      const doc = {
        userId: actor._id,
        recordedAt: rAt,
        metrics: {
          weightKg,
          notes: ''
        },
        hasPhotos: false,
        createdAt: now,
        createdByUserId: actor._id,
        updatedAt: null,
        isDeleted: false,
        source: {
          type: 'apple_health',
          integration: 'apple_health',
          appSourceName,
          deviceSourceName,
          externalSampleId,
          importedAt: now
        }
      };

      const result = await checkIns.insertOne(doc);
      const insertedCheckInId = result.insertedId;

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
        !existingProfileWeightRecordedAt ||
        rAt.getTime() >= existingProfileWeightRecordedAt.getTime();

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
      const users = db.collection('users');
      const userIntegrations = db.collection('userIntegrations');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
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
