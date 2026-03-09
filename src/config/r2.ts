import { S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error(
    'Missing R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env vars'
  );
}

export const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey
  }
});

export const R2_BUCKET = process.env.R2_BUCKET as string;

if (!R2_BUCKET) {
  throw new Error('Missing R2_BUCKET env var');
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
