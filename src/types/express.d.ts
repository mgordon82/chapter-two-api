import { AppUser } from '../middleware/requireAppUser';
import type { CognitoClaims } from '../middleware/requireCognitoAuth';

declare module 'express-serve-static-core' {
  interface Request {
    cognito?: CognitoClaims;
    user?: AppUser;
  }
}

export {};
