import { Router } from 'express';
import { z } from 'zod';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { cognito } from '../config/cognito';
import { getDb } from '../config/db';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { requireAppUser } from '../middleware/requireAppUser';
import { userProfileRouter } from './userProfile';
import { requireRole } from '../middleware/requireRole';

export const usersRouter = Router();

const inviteSchema = z.object({
  email: z
    .string()
    .email()
    .transform((s) => s.toLowerCase().trim()),
  role: z.enum(['client', 'coach', 'admin', 'staff']).default('client'),
  displayName: z.string().min(1).max(80).optional()
});

function getAttr(
  attrs: { Name?: string; Value?: string }[] | undefined,
  name: string
) {
  return attrs?.find((a) => a.Name === name)?.Value ?? null;
}

usersRouter.post(
  '/invite',
  requireCognitoAuth,
  requireAppUser,
  requireRole(['admin', 'staff', 'coach']),
  async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid request',
        details: parsed.error.flatten()
      });
    }

    const { email, role, displayName } = parsed.data;

    const userPoolId = process.env.COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      return res.status(500).json({ message: 'Missing COGNITO_USER_POOL_ID' });
    }

    try {
      const createRes = await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' }
          ],
          DesiredDeliveryMediums: ['EMAIL']
        })
      );

      let cognitoSub = getAttr(createRes.User?.Attributes, 'sub');

      if (!cognitoSub) {
        const getRes = await cognito.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username: email
          })
        );
        cognitoSub = getAttr(getRes.UserAttributes, 'sub');
      }

      if (!cognitoSub) {
        return res
          .status(502)
          .json({ message: 'Failed to determine Cognito sub' });
      }

      const db = getDb();
      const users = db.collection('users');
      const now = new Date();

      const safeDisplayName =
        typeof displayName === 'string' && displayName.trim().length > 0
          ? displayName.trim()
          : undefined;

      await users.updateOne(
        { email },
        {
          $setOnInsert: {
            email,
            role,
            status: 'invited',
            createdAt: now,
            ...(safeDisplayName ? { displayName: safeDisplayName } : {})
          },
          $set: {
            auth: { cognitoSub },
            updatedAt: now
          }
        },
        { upsert: true }
      );

      const user = await users.findOne({ email });

      return res.status(201).json({
        id: user ? String(user._id) : null,
        email,
        role: (user as any)?.role ?? role,
        status: (user as any)?.status ?? 'invited',
        cognitoSub
      });
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        return res
          .status(409)
          .json({ message: 'User already exists in Cognito' });
      }
      console.error('Invite error:', err);
      return res.status(500).json({ message: 'Failed to invite user' });
    }
  }
);

usersRouter.post(
  '/activate',
  requireCognitoAuth,
  requireAppUser,
  async (req, res) => {
    try {
      const db = getDb();
      const users = db.collection('users');
      const now = new Date();

      await users.updateOne(
        { 'auth.cognitoSub': req.cognito!.sub },
        { $set: { status: 'active', updatedAt: now } }
      );

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Activate error:', err);
      return res.status(500).json({ message: 'Failed to activate user' });
    }
  }
);

usersRouter.use('/current-user/profile', userProfileRouter);
