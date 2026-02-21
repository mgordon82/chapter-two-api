import type { CognitoClaims } from '../middleware/requireCognitoAuth';

declare module 'express-serve-static-core' {
  interface Request {
    cognito?: CognitoClaims;
  }
}

export {};
