import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';
import {
  mapCoachSummaries,
  mapCoachSummary
} from '../utils/coachSummaryMapper';
import { getCurrentActor } from '../utils/getCurrentActor';

export const coachSummariesRouter = Router();

coachSummariesRouter.post(
  '/current-user',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const {
        userId,
        periodType,
        periodKey,
        periodStart,
        periodEnd,
        relatedCheckInId,
        title,
        summary,
        visibleToUser
      } = req.body ?? {};

      if (typeof userId !== 'string' || !ObjectId.isValid(userId)) {
        return res
          .status(400)
          .json({ message: 'userId must be a valid ObjectId string' });
      }

      if (
        periodType !== 'day' &&
        periodType !== 'week' &&
        periodType !== 'month' &&
        periodType !== 'quarter' &&
        periodType !== 'year'
      ) {
        return res.status(400).json({
          message: 'periodType must be one of day, week, month, quarter, year'
        });
      }

      if (typeof periodKey !== 'string' || periodKey.trim().length === 0) {
        return res.status(400).json({ message: 'periodKey is required' });
      }

      const periodStartDate = new Date(periodStart);
      if (!periodStart || Number.isNaN(periodStartDate.getTime())) {
        return res.status(400).json({
          message: 'periodStart must be a valid ISO date string'
        });
      }

      const periodEndDate = new Date(periodEnd);
      if (!periodEnd || Number.isNaN(periodEndDate.getTime())) {
        return res.status(400).json({
          message: 'periodEnd must be a valid ISO date string'
        });
      }

      if (typeof summary !== 'string' || summary.trim().length === 0) {
        return res.status(400).json({ message: 'summary is required' });
      }

      const db = getDb();
      const coachSummaries = db.collection('coachSummaries');

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

      const existing = await coachSummaries.findOne({
        userId: new ObjectId(userId),
        coachUserId: actor._id,
        periodType,
        periodKey,
        isDeleted: false
      });

      if (existing) {
        await coachSummaries.updateOne(
          {
            _id: existing._id,
            isDeleted: false
          },
          {
            $set: {
              periodStart: periodStartDate,
              periodEnd: periodEndDate,
              relatedCheckInId:
                typeof relatedCheckInId === 'string' &&
                ObjectId.isValid(relatedCheckInId)
                  ? new ObjectId(relatedCheckInId)
                  : null,
              title: typeof title === 'string' ? title : null,
              summary: summary.trim(),
              visibleToUser:
                typeof visibleToUser === 'boolean' ? visibleToUser : true,
              updatedAt: now
            }
          }
        );

        const saved = await coachSummaries.findOne({
          _id: existing._id,
          isDeleted: false
        });

        return res.json({
          ok: true,
          action: 'updated',
          item: saved,
          mappedItem: saved ? mapCoachSummary(saved) : null
        });
      }

      const doc = {
        userId: new ObjectId(userId),
        coachUserId: actor._id,
        periodType,
        periodKey: periodKey.trim(),
        periodStart: periodStartDate,
        periodEnd: periodEndDate,
        relatedCheckInId:
          typeof relatedCheckInId === 'string' &&
          ObjectId.isValid(relatedCheckInId)
            ? new ObjectId(relatedCheckInId)
            : null,
        title: typeof title === 'string' ? title : null,
        summary: summary.trim(),
        createdAt: now,
        updatedAt: null,
        visibleToUser:
          typeof visibleToUser === 'boolean' ? visibleToUser : true,
        isDeleted: false
      };

      const result = await coachSummaries.insertOne(doc);

      const item = {
        ...doc,
        _id: result.insertedId
      };

      return res.status(201).json({
        ok: true,
        action: 'created',
        id: result.insertedId.toString(),
        item,
        mappedItem: mapCoachSummary(item)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to save coach summary'
      });
    }
  }
);

coachSummariesRouter.get(
  '/current-user',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const userId =
        typeof req.query.userId === 'string' ? req.query.userId.trim() : '';

      if (!userId || !ObjectId.isValid(userId)) {
        return res.status(400).json({
          message: 'userId must be a valid ObjectId string'
        });
      }

      const periodType =
        typeof req.query.periodType === 'string'
          ? req.query.periodType.trim()
          : '';

      const periodKey =
        typeof req.query.periodKey === 'string'
          ? req.query.periodKey.trim()
          : '';

      const db = getDb();
      const coachSummaries = db.collection('coachSummaries');

      const { actor, error } = await getCurrentActor({
        db,
        cognitoSub: sub
      });

      if (error || !actor) {
        return res.status(error?.status ?? 401).json({
          message: error?.message ?? 'User not found for this token'
        });
      }

      const query: Record<string, unknown> = {
        userId: new ObjectId(userId),
        coachUserId: actor._id,
        isDeleted: false
      };

      if (
        periodType === 'day' ||
        periodType === 'week' ||
        periodType === 'month' ||
        periodType === 'quarter' ||
        periodType === 'year'
      ) {
        query.periodType = periodType;
      }

      if (periodKey) {
        query.periodKey = periodKey;
      }

      const items = await coachSummaries
        .find(query)
        .sort({ periodStart: -1, createdAt: -1 })
        .toArray();

      return res.json({
        ok: true,
        items,
        mappedItems: mapCoachSummaries(items)
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to fetch coach summaries'
      });
    }
  }
);

coachSummariesRouter.delete(
  '/current-user/:id',
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
      const coachSummaries = db.collection('coachSummaries');

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

      const result = await coachSummaries.updateOne(
        {
          _id: new ObjectId(id),
          coachUserId: actor._id,
          isDeleted: false
        },
        {
          $set: {
            isDeleted: true,
            deletedAt: now,
            deletedByUserId: actor._id,
            updatedAt: now
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'Coach summary not found' });
      }

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to delete coach summary'
      });
    }
  }
);
