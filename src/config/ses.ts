import { SESClient } from '@aws-sdk/client-ses';

const region = process.env.COGNITO_REGION;

if (!region) {
  throw new Error('Missing COGNITO_REGION');
}

export const ses = new SESClient({ region });
