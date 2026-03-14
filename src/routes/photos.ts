import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../config/db';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import {
  buildProgressPhotoStorageKey,
  buildStarterPhotoStorageKey,
  createSignedPhotoUploadUrl,
  createSignedPhotoViewUrl,
  validateRequestedPhotoUploads
} from '../utils/r2Uploads';

export const photosRouter = Router();

photosRouter.post(
  '/starter/upload-session',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const photoSets = db.collection('photoSets');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
      }

      const validation = validateRequestedPhotoUploads(req.body?.photos, {
        requireFront: true,
        maxPhotos: 3
      });

      if (!validation.ok) {
        return res.status(400).json({ message: validation.message });
      }

      const existingStarterSet = await photoSets.findOne({
        userId: actor._id,
        type: 'starter',
        status: 'active',
        isDeleted: false
      });

      if (existingStarterSet) {
        return res.status(409).json({
          message: 'Active starter photos already exist for this user'
        });
      }

      const photoSetId = new ObjectId();

      const uploads = await Promise.all(
        validation.photos.map(async (photo) => {
          const storageKey = buildStarterPhotoStorageKey({
            userId: actor._id.toString(),
            photoSetId: photoSetId.toString(),
            position: photo.position,
            mimeType: photo.mimeType
          });

          const uploadUrl = await createSignedPhotoUploadUrl({
            storageKey,
            mimeType: photo.mimeType
          });

          return {
            position: photo.position,
            mimeType: photo.mimeType,
            originalFileName: photo.originalFileName ?? null,
            sizeBytes: photo.sizeBytes ?? null,
            storageKey,
            uploadUrl
          };
        })
      );

      return res.status(201).json({
        ok: true,
        photoSetId: photoSetId.toString(),
        uploads
      });
    } catch (err) {
      console.error('[photos/starter/upload-session] failed:', err);
      return res
        .status(500)
        .json({ message: 'Failed to create starter upload session' });
    }
  }
);

photosRouter.post('/starter/finalize', requireCognitoAuth, async (req, res) => {
  try {
    const sub = req.cognito?.sub;
    if (!sub) {
      return res.status(401).json({ message: 'Missing Cognito sub' });
    }

    const db = getDb();
    const users = db.collection('users');
    const photoSets = db.collection('photoSets');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });
    if (!actor) {
      return res.status(401).json({ message: 'User not found for this token' });
    }

    const { photoSetId, photos, takenAt } = req.body ?? {};

    if (
      !photoSetId ||
      typeof photoSetId !== 'string' ||
      !ObjectId.isValid(photoSetId)
    ) {
      return res
        .status(400)
        .json({ message: 'photoSetId must be a valid ObjectId string' });
    }

    let normalizedTakenAt: Date;

    if (takenAt == null || takenAt === '') {
      normalizedTakenAt = new Date();
    } else {
      normalizedTakenAt = new Date(takenAt);

      if (Number.isNaN(normalizedTakenAt.getTime())) {
        return res.status(400).json({
          message: 'takenAt must be a valid ISO date string'
        });
      }
    }

    const validation = validateRequestedPhotoUploads(photos, {
      requireFront: true,
      maxPhotos: 3
    });

    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const existingStarterSet = await photoSets.findOne({
      userId: actor._id,
      type: 'starter',
      status: 'active',
      isDeleted: false
    });

    if (existingStarterSet) {
      return res.status(409).json({
        message: 'Active starter photos already exist for this user'
      });
    }

    const normalizedPhotoSetId = new ObjectId(photoSetId);

    const finalizedPhotos = validation.photos.map((photo) => ({
      position: photo.position,
      storageKey: buildStarterPhotoStorageKey({
        userId: actor._id.toString(),
        photoSetId,
        position: photo.position,
        mimeType: photo.mimeType
      }),
      mimeType: photo.mimeType,
      originalFileName: photo.originalFileName ?? null,
      sizeBytes: photo.sizeBytes ?? null,
      uploadedAt: new Date(),
      takenAt: normalizedTakenAt
    }));

    const now = new Date();

    const doc = {
      _id: normalizedPhotoSetId,
      userId: actor._id,
      checkInId: null,
      type: 'starter',
      status: 'active',
      photos: finalizedPhotos,
      createdAt: now,
      createdByUserId: actor._id,
      updatedAt: null,
      isDeleted: false
    };

    await photoSets.insertOne(doc);

    return res.status(201).json({
      ok: true,
      photoSet: {
        id: normalizedPhotoSetId.toString(),
        photos: finalizedPhotos.map((photo) => ({
          position: photo.position,
          storageKey: photo.storageKey,
          mimeType: photo.mimeType,
          originalFileName: photo.originalFileName ?? null,
          sizeBytes: photo.sizeBytes ?? null,
          uploadedAt: photo.uploadedAt.toISOString(),
          takenAt: photo.takenAt.toISOString()
        }))
      }
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message: 'Active starter photos already exist for this user'
      });
    }

    console.error('[photos/starter/finalize] failed:', err);
    return res.status(500).json({
      message: 'Failed to finalize starter photos'
    });
  }
});

photosRouter.get('/starter', requireCognitoAuth, async (req, res) => {
  try {
    const sub = req.cognito?.sub;
    if (!sub) {
      return res.status(401).json({ message: 'Missing Cognito sub' });
    }

    const db = getDb();
    const users = db.collection('users');
    const photoSets = db.collection('photoSets');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });

    if (!actor) {
      return res.status(401).json({ message: 'User not found for this token' });
    }

    const starterSet = await photoSets.findOne({
      userId: actor._id,
      type: 'starter',
      status: 'active',
      isDeleted: false
    });

    if (!starterSet) {
      return res.json({
        ok: true,
        hasStarterPhotos: false
      });
    }

    const photosWithViewUrls = await Promise.all(
      starterSet.photos.map(async (photo: any) => {
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
          takenAt:
            photo.takenAt instanceof Date
              ? photo.takenAt.toISOString()
              : photo.takenAt ?? null,
          viewUrl
        };
      })
    );

    return res.json({
      ok: true,
      hasStarterPhotos: true,
      photoSet: {
        id: starterSet._id.toString(),
        photos: photosWithViewUrls
      }
    });
  } catch (err) {
    console.error('[photos/starter] failed:', err);
    return res.status(500).json({
      message: 'Failed to fetch starter photos'
    });
  }
});

photosRouter.post(
  '/progress/upload-session',
  requireCognitoAuth,
  async (req, res) => {
    const sub = req.cognito?.sub;

    try {
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const photoSets = db.collection('photoSets');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
      }

      const { photos } = req.body ?? {};

      const validation = validateRequestedPhotoUploads(photos, {
        requireFront: true,
        maxPhotos: 3
      });

      if (!validation.ok) {
        console.warn('[photos/progress/upload-session] validation failed', {
          sub,
          userId: actor._id.toString(),
          message: validation.message
        });

        return res.status(400).json({ message: validation.message });
      }

      const photoSetId = new ObjectId();

      const uploads = await Promise.all(
        validation.photos.map(async (photo) => {
          const storageKey = buildProgressPhotoStorageKey({
            userId: actor._id.toString(),
            photoSetId: photoSetId.toString(),
            position: photo.position,
            mimeType: photo.mimeType
          });

          const uploadUrl = await createSignedPhotoUploadUrl({
            storageKey,
            mimeType: photo.mimeType
          });

          return {
            position: photo.position,
            mimeType: photo.mimeType,
            originalFileName: photo.originalFileName ?? null,
            sizeBytes: photo.sizeBytes ?? null,
            storageKey,
            uploadUrl
          };
        })
      );

      const now = new Date();

      await photoSets.insertOne({
        _id: photoSetId,
        userId: actor._id,
        checkInId: null,
        type: 'progress',
        status: 'pending',
        photos: [],
        createdAt: now,
        finalizedAt: null,
        attachedAt: null,
        createdByUserId: actor._id,
        updatedAt: null,
        isDeleted: false
      });

      return res.status(201).json({
        ok: true,
        photoSetId: photoSetId.toString(),
        uploads
      });
    } catch (err) {
      console.error('[photos/progress/upload-session] failed', {
        sub: sub ?? null,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });

      return res.status(500).json({
        message: 'Failed to create progress upload session'
      });
    }
  }
);

photosRouter.post(
  '/progress/finalize',
  requireCognitoAuth,
  async (req, res) => {
    const sub = req.cognito?.sub;

    try {
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const photoSets = db.collection('photoSets');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
      }

      const { photoSetId, photos } = req.body ?? {};

      if (
        !photoSetId ||
        typeof photoSetId !== 'string' ||
        !ObjectId.isValid(photoSetId)
      ) {
        return res
          .status(400)
          .json({ message: 'photoSetId must be a valid ObjectId string' });
      }

      const validation = validateRequestedPhotoUploads(photos, {
        requireFront: true,
        maxPhotos: 3
      });

      if (!validation.ok) {
        console.warn('[photos/progress/finalize] validation failed', {
          sub,
          userId: actor._id.toString(),
          photoSetId,
          message: validation.message
        });

        return res.status(400).json({ message: validation.message });
      }

      const existingPhotoSet = await photoSets.findOne({
        _id: new ObjectId(photoSetId),
        userId: actor._id,
        type: 'progress',
        isDeleted: false
      });

      if (!existingPhotoSet) {
        return res
          .status(404)
          .json({ message: 'Progress photo set not found' });
      }

      if (existingPhotoSet.status === 'attached') {
        return res.status(409).json({
          message: 'Progress photo set has already been attached to a check-in'
        });
      }

      const finalizedPhotos = validation.photos.map((photo) => ({
        position: photo.position,
        storageKey: buildProgressPhotoStorageKey({
          userId: actor._id.toString(),
          photoSetId,
          position: photo.position,
          mimeType: photo.mimeType
        }),
        mimeType: photo.mimeType,
        originalFileName: photo.originalFileName ?? null,
        sizeBytes: photo.sizeBytes ?? null,
        uploadedAt: new Date()
      }));

      const now = new Date();

      await photoSets.updateOne(
        {
          _id: new ObjectId(photoSetId),
          userId: actor._id,
          type: 'progress',
          isDeleted: false
        },
        {
          $set: {
            status: 'finalized',
            photos: finalizedPhotos,
            finalizedAt: now,
            updatedAt: now
          }
        }
      );

      return res.status(201).json({
        ok: true,
        photoSetId,
        photos: finalizedPhotos.map((photo) => ({
          position: photo.position,
          storageKey: photo.storageKey,
          mimeType: photo.mimeType,
          originalFileName: photo.originalFileName ?? null,
          sizeBytes: photo.sizeBytes ?? null,
          uploadedAt: photo.uploadedAt.toISOString()
        }))
      });
    } catch (err) {
      console.error('[photos/progress/finalize] failed', {
        sub: sub ?? null,
        photoSetId:
          typeof req.body?.photoSetId === 'string' ? req.body.photoSetId : null,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });

      return res.status(500).json({
        message: 'Failed to finalize progress photos'
      });
    }
  }
);
