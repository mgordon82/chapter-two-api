import { Router } from 'express';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';
import { getLocalDateKey, parseLocalDateInput } from '../utils/periods';
import {
  mapExerciseSession,
  mapExerciseSessions
} from '../utils/exerciseSessionMapper';
import { getCurrentActor } from '../utils/getCurrentActor';

export const exerciseSessionsRouter = Router();

exerciseSessionsRouter.post(
  '/current-user',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
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

      const {
        performedAt,
        startedAt,
        endedAt,
        sessionType,
        name,
        focusArea,
        notes,
        metrics
      } = req.body ?? {};

      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'name is required' });
      }

      const performedAtDate = performedAt ? new Date(performedAt) : new Date();
      if (Number.isNaN(performedAtDate.getTime())) {
        return res.status(400).json({
          message: 'performedAt must be a valid ISO date string'
        });
      }

      const startedAtDate =
        startedAt != null && startedAt !== '' ? new Date(startedAt) : null;

      if (startedAtDate && Number.isNaN(startedAtDate.getTime())) {
        return res.status(400).json({
          message: 'startedAt must be a valid ISO date string'
        });
      }

      const endedAtDate =
        endedAt != null && endedAt !== '' ? new Date(endedAt) : null;

      if (endedAtDate && Number.isNaN(endedAtDate.getTime())) {
        return res.status(400).json({
          message: 'endedAt must be a valid ISO date string'
        });
      }

      const durationMinutes =
        metrics?.durationMinutes != null && metrics.durationMinutes !== ''
          ? Number(metrics.durationMinutes)
          : null;

      if (
        durationMinutes != null &&
        (!Number.isFinite(durationMinutes) || durationMinutes < 0)
      ) {
        return res.status(400).json({
          message: 'metrics.durationMinutes must be a non-negative number'
        });
      }

      const caloriesBurned =
        metrics?.caloriesBurned != null && metrics.caloriesBurned !== ''
          ? Number(metrics.caloriesBurned)
          : null;

      if (
        caloriesBurned != null &&
        (!Number.isFinite(caloriesBurned) || caloriesBurned < 0)
      ) {
        return res.status(400).json({
          message: 'metrics.caloriesBurned must be a non-negative number'
        });
      }

      const distanceMeters =
        metrics?.distanceMeters != null && metrics.distanceMeters !== ''
          ? Number(metrics.distanceMeters)
          : null;

      if (
        distanceMeters != null &&
        (!Number.isFinite(distanceMeters) || distanceMeters < 0)
      ) {
        return res.status(400).json({
          message: 'metrics.distanceMeters must be a non-negative number'
        });
      }

      const stepCount =
        metrics?.stepCount != null && metrics.stepCount !== ''
          ? Number(metrics.stepCount)
          : null;

      if (stepCount != null && (!Number.isFinite(stepCount) || stepCount < 0)) {
        return res.status(400).json({
          message: 'metrics.stepCount must be a non-negative number'
        });
      }

      const now = new Date();

      const doc = {
        userId: actor._id,

        performedAt: performedAtDate,
        localDateKey: getLocalDateKey(performedAtDate),
        startedAt: startedAtDate,
        endedAt: endedAtDate,

        source: {
          type: 'manual',
          integration: null,
          externalId: null,
          importedAt: null
        },

        sessionType: typeof sessionType === 'string' ? sessionType : null,
        name: name.trim(),
        focusArea: typeof focusArea === 'string' ? focusArea.trim() : null,
        notes: typeof notes === 'string' ? notes.trim() : null,

        metrics: {
          durationMinutes,
          caloriesBurned,
          distanceMeters,
          stepCount
        },

        links: {
          plannedWorkoutId: null,
          completedWorkoutId: null
        },

        createdAt: now,
        createdByUserId: actor._id,
        updatedAt: null,
        updatedByUserId: null,

        isDeleted: false
      };

      const result = await exerciseSessions.insertOne(doc);

      const item = {
        ...doc,
        _id: result.insertedId
      };

      return res.status(201).json({
        ok: true,
        id: result.insertedId.toString(),
        item,
        mappedItem: mapExerciseSession(item)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to create exercise session'
      });
    }
  }
);

exerciseSessionsRouter.post(
  '/current-user/import/apple-health',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const exerciseSessions = db.collection('exerciseSessions');

      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found'
        });
      }

      const {
        externalId,
        startDate,
        endDate,
        durationMinutes,
        activityType,
        activityName,
        source
      } = req.body ?? {};

      if (!externalId || !startDate) {
        return res.status(400).json({
          message: 'externalId and startDate are required'
        });
      }

      const performedAt = new Date(startDate);
      if (Number.isNaN(performedAt.getTime())) {
        return res.status(400).json({
          message: 'Invalid startDate'
        });
      }

      // 🔒 prevent duplicates
      const existing = await exerciseSessions.findOne({
        userId: actor._id,
        'source.integration': 'apple_health',
        'source.externalId': externalId,
        isDeleted: false
      });

      if (existing) {
        return res.json({
          ok: true,
          status: 'duplicate',
          id: existing._id.toString()
        });
      }

      const now = new Date();

      const doc = {
        userId: actor._id,

        performedAt,
        localDateKey: getLocalDateKey(performedAt),
        startedAt: performedAt,
        endedAt: endDate ? new Date(endDate) : null,

        source: {
          type: 'imported',
          integration: 'apple_health',
          externalId,
          importedAt: now,
          appSourceName: source?.appSourceName ?? null,
          deviceSourceName: source?.deviceSourceName ?? null
        },

        sessionType: String(activityType ?? 'unknown'),
        name:
          typeof activityName === 'string' && activityName.trim().length > 0
            ? activityName.trim()
            : 'Workout',
        focusArea: null,
        notes: null,

        metrics: {
          durationMinutes: durationMinutes ?? null,
          caloriesBurned: null,
          distanceMeters: null,
          stepCount: null
        },

        links: {
          plannedWorkoutId: null,
          completedWorkoutId: null
        },

        createdAt: now,
        createdByUserId: actor._id,
        updatedAt: null,
        updatedByUserId: null,

        isDeleted: false
      };

      const result = await exerciseSessions.insertOne(doc);

      return res.status(201).json({
        ok: true,
        status: 'created',
        id: result.insertedId.toString()
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to import Apple Health workout'
      });
    }
  }
);

exerciseSessionsRouter.get(
  '/current-user',
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
        return res.status(400).json({
          message: 'date must be a valid ISO date string'
        });
      }

      const db = getDb();
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

      const localDateKey = getLocalDateKey(targetDate);

      const items = await exerciseSessions
        .find({
          userId: actor._id,
          localDateKey,
          isDeleted: false
        })
        .sort({ performedAt: 1, createdAt: 1 })
        .toArray();

      return res.json({
        ok: true,
        date: localDateKey,
        items,
        mappedItems: mapExerciseSessions(items)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to fetch exercise sessions'
      });
    }
  }
);
