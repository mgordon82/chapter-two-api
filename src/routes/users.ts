import { Router } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
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

type AppRole = 'client' | 'coach' | 'admin' | 'staff';

const VALID_ROLES: AppRole[] = ['client', 'coach', 'admin', 'staff'];

function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && VALID_ROLES.includes(value as AppRole);
}

function normalizeRoles(input: unknown): AppRole[] {
  if (!Array.isArray(input)) return [];

  const filtered = input.filter(isAppRole);

  return [...new Set(filtered)];
}

function getStoredUserRoles(user: any): AppRole[] {
  const roles = normalizeRoles(user?.roles);
  if (roles.length > 0) return roles;

  return isAppRole(user?.role) ? [user.role] : [];
}

function expandRoles(roles: AppRole[]): AppRole[] {
  const expanded = new Set<AppRole>(roles);

  if (expanded.has('admin')) {
    expanded.add('coach');
    expanded.add('client');
  }

  if (expanded.has('coach')) {
    expanded.add('client');
  }

  return Array.from(expanded);
}

const inviteSchema = z
  .object({
    email: z
      .string()
      .email()
      .transform((s) => s.toLowerCase().trim()),
    role: z.enum(['client', 'coach', 'admin', 'staff']).optional(),
    roles: z.array(z.enum(['client', 'coach', 'admin', 'staff'])).optional(),
    coachId: z.string().nullable().optional(),
    displayName: z.string().min(1).max(80).optional()
  })
  .superRefine((data, ctx) => {
    const hasRole = typeof data.role === 'string';
    const hasRoles = Array.isArray(data.roles) && data.roles.length > 0;

    if (!hasRole && !hasRoles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one role is required',
        path: ['roles']
      });
    }
  });

const assignCoachSchema = z.object({
  coachId: z.string().nullable()
});

function getAttr(
  attrs: { Name?: string; Value?: string }[] | undefined,
  name: string
) {
  return attrs?.find((a) => a.Name === name)?.Value ?? null;
}

usersRouter.get(
  '/',
  requireCognitoAuth,
  requireAppUser,
  requireRole(['admin', 'staff', 'coach']),
  async (req, res) => {
    try {
      const db = getDb();
      const requester = (req as any).user;
      const requesterId = String((requester as any)?._id);

      const requesterStoredRoles = getStoredUserRoles(requester);
      const requesterEffectiveRoles = expandRoles(requesterStoredRoles);

      const isAdminLike =
        requesterEffectiveRoles.includes('admin') ||
        requesterEffectiveRoles.includes('staff');

      const pipeline: any[] = [
        {
          $lookup: {
            from: 'userProfiles',
            localField: '_id',
            foreignField: 'userId',
            as: 'profile'
          }
        },
        {
          $unwind: {
            path: '$profile',
            preserveNullAndEmptyArrays: true
          }
        }
      ];

      if (!isAdminLike) {
        pipeline.push({
          $match: {
            'profile.coachId': new ObjectId(requesterId)
          }
        });
      }

      pipeline.push(
        {
          $lookup: {
            from: 'users',
            localField: 'profile.coachId',
            foreignField: '_id',
            as: 'coachUser'
          }
        },
        {
          $unwind: {
            path: '$coachUser',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $lookup: {
            from: 'userProfiles',
            localField: 'coachUser._id',
            foreignField: 'userId',
            as: 'coachProfile'
          }
        },
        {
          $unwind: {
            path: '$coachProfile',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            email: 1,
            role: 1,
            roles: 1,
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            firstName: '$profile.firstName',
            lastName: '$profile.lastName',
            coachId: '$coachUser._id',
            coachEmail: '$coachUser.email',
            coachFirstName: '$coachProfile.firstName',
            coachLastName: '$coachProfile.lastName'
          }
        },
        {
          $sort: {
            createdAt: -1,
            _id: -1
          }
        }
      );

      const docs = await db.collection('users').aggregate(pipeline).toArray();

      return res.status(200).json({
        items: docs.map((doc) => {
          const firstName =
            typeof doc.firstName === 'string' ? doc.firstName.trim() : '';
          const lastName =
            typeof doc.lastName === 'string' ? doc.lastName.trim() : '';
          const fullName = [firstName, lastName].filter(Boolean).join(' ');

          const coachFirstName =
            typeof doc.coachFirstName === 'string'
              ? doc.coachFirstName.trim()
              : '';
          const coachLastName =
            typeof doc.coachLastName === 'string'
              ? doc.coachLastName.trim()
              : '';
          const coachFullName = [coachFirstName, coachLastName]
            .filter(Boolean)
            .join(' ');

          const mappedRoles = normalizeRoles((doc as any).roles);
          const responseRoles =
            mappedRoles.length > 0
              ? mappedRoles
              : isAppRole((doc as any).role)
              ? [(doc as any).role]
              : [];

          return {
            id: String(doc._id),
            displayName: fullName || null,
            email: typeof doc.email === 'string' ? doc.email : '',
            role: isAppRole((doc as any).role)
              ? (doc as any).role
              : responseRoles[0] ?? null,
            roles: responseRoles,
            status: typeof doc.status === 'string' ? doc.status : null,
            createdAt: doc.createdAt ?? null,
            updatedAt: doc.updatedAt ?? null,
            assignedCoach:
              doc.coachId && typeof doc.coachEmail === 'string'
                ? {
                    id: String(doc.coachId),
                    displayName: coachFullName || null,
                    email: doc.coachEmail
                  }
                : null
          };
        })
      });
    } catch (err) {
      console.error('List users error:', err);
      return res.status(500).json({ message: 'Failed to list users' });
    }
  }
);

usersRouter.get(
  '/coaches',
  requireCognitoAuth,
  requireAppUser,
  requireRole(['admin', 'staff']),
  async (_req, res) => {
    try {
      const db = getDb();
      const users = db.collection('users');
      const userProfiles = db.collection('userProfiles');

      const coachUsers = await users
        .find({
          $or: [{ role: 'coach' }, { roles: 'coach' }]
        })
        .toArray();
      const coachUserIds = coachUsers.map((user) => user._id);

      const coachProfiles = await userProfiles
        .find({ userId: { $in: coachUserIds } })
        .toArray();

      const items = coachUsers.map((user) => {
        const profile = coachProfiles.find(
          (p) => String((p as any).userId) === String(user._id)
        );

        const firstName =
          typeof (profile as any)?.firstName === 'string'
            ? (profile as any).firstName.trim()
            : '';
        const lastName =
          typeof (profile as any)?.lastName === 'string'
            ? (profile as any).lastName.trim()
            : '';
        const displayName = [firstName, lastName].filter(Boolean).join(' ');

        return {
          id: String(user._id),
          email:
            typeof (user as any).email === 'string' ? (user as any).email : '',
          displayName: displayName || null
        };
      });

      return res.status(200).json({ items });
    } catch (err) {
      console.error('List coaches error:', err);
      return res.status(500).json({ message: 'Failed to load coaches' });
    }
  }
);

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

    const {
      email,
      role,
      roles: rolesInput,
      coachId,
      displayName
    } = parsed.data;

    const roles = normalizeRoles(
      Array.isArray(rolesInput) && rolesInput.length > 0
        ? rolesInput
        : role
        ? [role]
        : []
    );

    if (roles.length === 0) {
      return res
        .status(400)
        .json({ message: 'At least one valid role is required' });
    }

    const primaryRole = roles[0];

    const inviter = (req as any).user;
    const inviterStoredRoles = getStoredUserRoles(inviter);
    const inviterEffectiveRoles = expandRoles(inviterStoredRoles);

    const isAdminLike =
      inviterEffectiveRoles.includes('admin') ||
      inviterEffectiveRoles.includes('staff');

    const isCoachOnly = inviterEffectiveRoles.includes('coach') && !isAdminLike;

    let resolvedCoachId: ObjectId | null = null;

    if (coachId !== null && coachId !== undefined && coachId !== '') {
      if (!ObjectId.isValid(coachId)) {
        return res.status(400).json({ message: 'Invalid coach id' });
      }

      const requestedCoachObjectId = new ObjectId(coachId);

      if (isCoachOnly) {
        if (String(inviter?._id) !== coachId) {
          return res.status(403).json({
            message: 'Coaches may only assign invited users to themselves'
          });
        }

        resolvedCoachId = requestedCoachObjectId;
      } else {
        resolvedCoachId = requestedCoachObjectId;
      }
    }

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

      const userProfiles = db.collection('userProfiles');

      if (resolvedCoachId) {
        const coachUser = await users.findOne({ _id: resolvedCoachId });

        if (!coachUser) {
          return res.status(404).json({ message: 'Coach not found' });
        }

        const coachRoles = expandRoles(getStoredUserRoles(coachUser));
        const isCoach = coachRoles.includes('coach');

        if (!isCoach) {
          return res
            .status(400)
            .json({ message: 'Selected user is not a coach' });
        }
      }

      const safeDisplayName =
        typeof displayName === 'string' && displayName.trim().length > 0
          ? displayName.trim()
          : undefined;

      await users.updateOne(
        { email },
        {
          $setOnInsert: {
            email,
            status: 'invited',
            createdAt: now,
            ...(safeDisplayName ? { displayName: safeDisplayName } : {})
          },
          $set: {
            auth: { cognitoSub },
            roles,
            role: primaryRole,
            updatedAt: now
          }
        },
        { upsert: true }
      );

      const user = await users.findOne({ email });

      if (user) {
        const invitedUserId = new ObjectId(String((user as any)._id));

        await userProfiles.updateOne(
          { userId: invitedUserId },
          {
            $setOnInsert: {
              userId: invitedUserId,
              createdAt: now
            },
            $set: {
              coachId: resolvedCoachId,
              coachAssignedAt: resolvedCoachId ? now : null,
              updatedAt: now
            }
          },
          { upsert: true }
        );
      }

      const savedRoles = normalizeRoles((user as any)?.roles);
      const responseRoles =
        savedRoles.length > 0
          ? savedRoles
          : isAppRole((user as any)?.role)
          ? [(user as any).role]
          : roles;

      return res.status(201).json({
        id: user ? String(user._id) : null,
        email,
        role: (user as any)?.role ?? primaryRole,
        roles: responseRoles,
        coachId: resolvedCoachId ? String(resolvedCoachId) : null,
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

const updateRolesSchema = z.object({
  roles: z.array(z.enum(['client', 'coach', 'admin', 'staff'])).min(1)
});

usersRouter.patch(
  '/:userId/roles',
  requireCognitoAuth,
  requireAppUser,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    const parsed = updateRolesSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    const { roles } = parsed.data;

    const userIdParam = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;

    if (!ObjectId.isValid(userIdParam)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const db = getDb();
    const users = db.collection('users');

    const userId = new ObjectId(userIdParam);
    const now = new Date();

    try {
      const primaryRole = roles[0];

      const result = await users.updateOne(
        { _id: userId },
        {
          $set: {
            roles,
            role: primaryRole,
            updatedAt: now
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json({
        ok: true,
        user: {
          id: userIdParam,
          role: primaryRole,
          roles
        }
      });
    } catch (err) {
      console.error('Update roles error:', err);
      return res.status(500).json({ message: 'Failed to update roles' });
    }
  }
);

usersRouter.post(
  '/:userId/assign-coach',
  requireCognitoAuth,
  requireAppUser,
  requireRole(['admin', 'staff']),
  async (req, res) => {
    const parsed = assignCoachSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    const { coachId } = parsed.data;
    const userIdParam = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;

    if (!ObjectId.isValid(userIdParam)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    if (coachId !== null && !ObjectId.isValid(coachId)) {
      return res.status(400).json({ message: 'Invalid coach id' });
    }

    const db = getDb();
    const now = new Date();
    const userId = new ObjectId(userIdParam);

    const users = db.collection('users');
    const userProfiles = db.collection('userProfiles');

    try {
      const targetUser = await users.findOne({ _id: userId });

      if (!targetUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (coachId !== null) {
        const coachObjectId = new ObjectId(coachId);
        const coachUser = await users.findOne({ _id: coachObjectId });

        if (!coachUser) {
          return res.status(404).json({ message: 'Coach not found' });
        }

        const coachUserRoles = normalizeRoles((coachUser as any).roles);
        const isCoach =
          coachUserRoles.includes('coach') ||
          (coachUser as any).role === 'coach';

        if (!isCoach) {
          return res
            .status(400)
            .json({ message: 'Selected user is not a coach' });
        }

        await userProfiles.updateOne(
          { userId },
          {
            $setOnInsert: {
              userId,
              createdAt: now
            },
            $set: {
              coachId: coachObjectId,
              coachAssignedAt: now,
              updatedAt: now
            }
          },
          { upsert: true }
        );
      } else {
        await userProfiles.updateOne(
          { userId },
          {
            $setOnInsert: {
              userId,
              createdAt: now
            },
            $set: {
              coachId: null,
              coachAssignedAt: null,
              updatedAt: now
            }
          },
          { upsert: true }
        );
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Assign coach error:', err);
      return res.status(500).json({ message: 'Failed to assign coach' });
    }
  }
);

usersRouter.post('/activate', requireCognitoAuth, async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const now = new Date();

    const result = await users.updateOne(
      { 'auth.cognitoSub': req.cognito!.sub },
      { $set: { status: 'active', updatedAt: now } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'App user not found' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Activate error:', err);
    return res.status(500).json({ message: 'Failed to activate user' });
  }
});

usersRouter.use('/current-user/profile', userProfileRouter);
