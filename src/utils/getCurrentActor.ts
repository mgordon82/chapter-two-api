import type { Db } from 'mongodb';

export async function getCurrentActor(params: {
  db: Db;
  cognitoSub: string | undefined;
}) {
  const { db, cognitoSub } = params;

  if (!cognitoSub) {
    return {
      actor: null,
      error: {
        status: 401,
        message: 'Missing Cognito sub'
      }
    };
  }

  const users = db.collection('users');

  const actor = await users.findOne({ 'auth.cognitoSub': cognitoSub });

  if (!actor) {
    return {
      actor: null,
      error: {
        status: 401,
        message: 'User not found for this token'
      }
    };
  }

  return {
    actor,
    error: null
  };
}
