import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const region = process.env.COGNITO_REGION!;
const userPoolId = process.env.COGNITO_USER_POOL_ID!;
const clientId = process.env.COGNITO_APP_CLIENT_ID!;

if (!region || !userPoolId || !clientId) {
  throw new Error(
    'Missing COGNITO_REGION / COGNITO_USER_POOL_ID / COGNITO_APP_CLIENT_ID env vars'
  );
}

const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export type CognitoClaims = {
  sub: string;
  token_use: 'access' | 'id';
  client_id?: string;
  scope?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
};

export async function requireCognitoAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;

    if (!token) {
      return res
        .status(401)
        .json({ message: 'Missing Authorization: Bearer <token>' });
    }

    const { payload } = await jwtVerify(token, jwks, { issuer });
    const claims = payload as unknown as CognitoClaims;

    // API should use ACCESS token
    if (claims.token_use !== 'access') {
      return res
        .status(401)
        .json({ message: 'Use an access token for API requests' });
    }

    // Cognito access tokens usually have `client_id` rather than `aud`
    if (claims.client_id !== clientId) {
      return res.status(401).json({ message: 'Token client mismatch' });
    }

    req.cognito = claims;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}
