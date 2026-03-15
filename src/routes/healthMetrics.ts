import { Router } from 'express';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { getDb } from '../config/db';

export const healthMetricsRouter = Router();

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
            permissions: {
              steps: true
            },
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
