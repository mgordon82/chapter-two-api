import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

const region = process.env.COGNITO_REGION;

if (!region) {
  throw new Error('Missing COGNITO_REGION');
}

export const cognito = new CognitoIdentityProviderClient({ region });
