import { Router } from 'express';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const healthMetricsRouter = Router();

healthMetricsRouter.get(
  '/current-user/daily',
  requireCognitoAuth,
  async (req, res) => {
    try {
      const sub = req.cognito?.sub;
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const healthMetricDaily = db.collection('healthMetricDaily');

      const actor = await users.findOne({ 'auth.cognitoSub': sub });
      if (!actor) {
        return res
          .status(401)
          .json({ message: 'User not found for this token' });
      }

      const metricTypeRaw =
        typeof req.query.metricType === 'string'
          ? req.query.metricType.trim()
          : '';

      if (!metricTypeRaw) {
        return res.status(400).json({
          message: 'metricType is required'
        });
      }

      const allowedMetricTypes = new Set(['steps']);

      if (!allowedMetricTypes.has(metricTypeRaw)) {
        return res.status(400).json({
          message: 'Invalid metricType'
        });
      }

      const rangeRaw =
        typeof req.query.range === 'string' ? req.query.range.trim() : '30D';

      const end = new Date();
      const start = new Date(end);

      switch (rangeRaw) {
        case '7D':
          start.setDate(start.getDate() - 7);
          break;
        case '30D':
          start.setDate(start.getDate() - 30);
          break;
        case '90D':
          start.setDate(start.getDate() - 90);
          break;
        case '180D':
          start.setDate(start.getDate() - 180);
          break;
        case '365D':
          start.setDate(start.getDate() - 365);
          break;
        default:
          return res.status(400).json({ message: 'Invalid range' });
      }

      const startDateString = start.toISOString().slice(0, 10);
      const endDateString = end.toISOString().slice(0, 10);

      const items = await healthMetricDaily
        .find({
          userId: actor._id,
          isDeleted: false,
          metricType: metricTypeRaw,
          date: {
            $gte: startDateString,
            $lte: endDateString
          }
        })
        .sort({ date: -1, createdAt: -1 })
        .toArray();

      return res.json({
        ok: true,
        metricType: metricTypeRaw,
        range: rangeRaw,
        items
      });
    } catch (err) {
      return res.status(500).json({
        message: 'Failed to fetch daily health metrics'
      });
    }
  }
);

healthMetricsRouter.post(
  '/current-user/import/apple-health/steps',
  requireCognitoAuth,
  async (req, res) => {
    const sub = req.cognito?.sub;

    try {
      if (!sub) {
        return res.status(401).json({ message: 'Missing Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const userProfiles = db.collection('userProfiles');
      const userIntegrations = db.collection('userIntegrations');
      const healthMetricDaily = db.collection('healthMetricDaily');

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
            createdAt: new Date()
          },
          $set: {
            updatedAt: new Date(),
            'permissions.steps': true
          }
        },
        { upsert: true }
      );

      const { date, metricType, value, source } = req.body ?? {};

      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          message: 'date must be a valid YYYY-MM-DD string'
        });
      }

      if (metricType !== 'steps') {
        return res.status(400).json({
          message: 'metricType must be "steps"'
        });
      }

      const steps = Number(value);
      if (!Number.isFinite(steps) || steps < 0) {
        return res.status(400).json({
          message: 'value must be a non-negative number'
        });
      }

      const roundedSteps = Math.round(steps);

      const appSourceName =
        typeof source?.appSourceName === 'string' ? source.appSourceName : null;

      const deviceSourceName =
        typeof source?.deviceSourceName === 'string'
          ? source.deviceSourceName
          : null;

      const sourceType = source?.type === 'manual' ? 'manual' : 'apple_health';

      const now = new Date();

      const existing = await healthMetricDaily.findOne({
        userId: actor._id,
        isDeleted: false,
        date,
        metricType: 'steps',
        'source.type': sourceType
      });

      if (existing) {
        await healthMetricDaily.updateOne(
          {
            _id: existing._id
          },
          {
            $set: {
              value: roundedSteps,
              updatedAt: now,
              source: {
                type: sourceType,
                integration:
                  sourceType === 'apple_health' ? 'apple_health' : null,
                appSourceName,
                deviceSourceName,
                importedAt: sourceType === 'apple_health' ? now : null
              }
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
              'lastSync.stepsImportedAt': now,
              'lastSync.stepsDate': date
            }
          }
        );

        const existingProfile = await userProfiles.findOne({
          userId: actor._id
        });

        const existingLatestStepsDate =
          typeof existingProfile?.latestStepsDate === 'string'
            ? existingProfile.latestStepsDate
            : null;

        const shouldUpdateProfileSteps =
          !existingLatestStepsDate || date >= existingLatestStepsDate;

        if (shouldUpdateProfileSteps) {
          await userProfiles.updateOne(
            { userId: actor._id },
            {
              $set: {
                latestSteps: roundedSteps,
                latestStepsDate: date,
                updatedAt: now
              }
            }
          );
        }

        return res.status(200).json({
          ok: true,
          status: 'updated',
          id: existing._id.toString()
        });
      }

      const doc = {
        userId: actor._id,
        date,
        metricType: 'steps',
        value: roundedSteps,
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
        source: {
          type: sourceType,
          integration: sourceType === 'apple_health' ? 'apple_health' : null,
          appSourceName,
          deviceSourceName,
          importedAt: sourceType === 'apple_health' ? now : null
        }
      };

      const result = await healthMetricDaily.insertOne(doc);

      await userIntegrations.updateOne(
        {
          userId: actor._id,
          integration: 'apple_health'
        },
        {
          $set: {
            updatedAt: now,
            'lastSync.stepsImportedAt': now,
            'lastSync.stepsDate': date
          }
        }
      );

      const existingProfile = await userProfiles.findOne({ userId: actor._id });

      const existingLatestStepsDate =
        typeof existingProfile?.latestStepsDate === 'string'
          ? existingProfile.latestStepsDate
          : null;

      const shouldUpdateProfileSteps =
        !existingLatestStepsDate || date >= existingLatestStepsDate;

      if (shouldUpdateProfileSteps) {
        await userProfiles.updateOne(
          { userId: actor._id },
          {
            $set: {
              latestSteps: roundedSteps,
              latestStepsDate: date,
              updatedAt: now
            }
          }
        );
      }

      return res.status(201).json({
        ok: true,
        status: 'created',
        id: result.insertedId.toString()
      });
    } catch (err) {
      console.error('[healthMetrics/importAppleHealthSteps] failed', {
        sub: sub ?? null,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });

      return res.status(500).json({
        message: 'Failed to import Apple Health steps'
      });
    }
  }
);
