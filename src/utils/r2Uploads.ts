import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  R2_BUCKET,
  r2Client
} from '../config/r2';

export const PHOTO_POSITIONS = ['front', 'side', 'back'] as const;
export type PhotoPosition = (typeof PHOTO_POSITIONS)[number];

export type RequestedPhotoUpload = {
  position: PhotoPosition;
  mimeType: string;
  originalFileName?: string | null;
  sizeBytes?: number | null;
};

export function isValidPhotoPosition(value: unknown): value is PhotoPosition {
  return (
    typeof value === 'string' &&
    (PHOTO_POSITIONS as readonly string[]).includes(value)
  );
}

export function validateRequestedPhotoUploads(
  photos: unknown,
  options?: {
    requireFront?: boolean;
    maxPhotos?: number;
  }
):
  | {
      ok: true;
      photos: RequestedPhotoUpload[];
    }
  | {
      ok: false;
      message: string;
    } {
  const requireFront = options?.requireFront ?? false;
  const maxPhotos = options?.maxPhotos ?? 3;

  if (!Array.isArray(photos) || photos.length === 0) {
    return { ok: false, message: 'photos must be a non-empty array' };
  }

  if (photos.length > maxPhotos) {
    return {
      ok: false,
      message: `No more than ${maxPhotos} photos are allowed`
    };
  }

  const seenPositions = new Set<string>();
  const normalized: RequestedPhotoUpload[] = [];

  for (const item of photos) {
    if (!item || typeof item !== 'object') {
      return { ok: false, message: 'Each photo must be an object' };
    }

    const position = (item as any).position;
    const mimeType = (item as any).mimeType;
    const originalFileName = (item as any).originalFileName;
    const sizeBytesRaw = (item as any).sizeBytes;

    if (!isValidPhotoPosition(position)) {
      return {
        ok: false,
        message: 'photo position must be one of: front, side, back'
      };
    }

    if (seenPositions.has(position)) {
      return {
        ok: false,
        message: `Duplicate photo position provided: ${position}`
      };
    }
    seenPositions.add(position);

    if (
      typeof mimeType !== 'string' ||
      !ALLOWED_MIME_TYPES.includes(mimeType)
    ) {
      return {
        ok: false,
        message: `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`
      };
    }

    if (
      sizeBytesRaw != null &&
      (!Number.isFinite(Number(sizeBytesRaw)) ||
        Number(sizeBytesRaw) <= 0 ||
        Number(sizeBytesRaw) > MAX_PHOTO_BYTES)
    ) {
      return {
        ok: false,
        message: `sizeBytes must be between 1 and ${MAX_PHOTO_BYTES}`
      };
    }

    normalized.push({
      position,
      mimeType,
      originalFileName:
        typeof originalFileName === 'string' ? originalFileName : null,
      sizeBytes: sizeBytesRaw == null ? null : Number(sizeBytesRaw)
    });
  }

  if (requireFront && !seenPositions.has('front')) {
    return {
      ok: false,
      message: 'A front photo is required'
    };
  }

  return { ok: true, photos: normalized };
}

export function getPhotoExtensionFromMimeType(mimeType: string): 'jpg' | 'png' {
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}

export function buildStarterPhotoStorageKey(params: {
  userId: string;
  photoSetId: string;
  position: PhotoPosition;
  mimeType: string;
}) {
  const ext = getPhotoExtensionFromMimeType(params.mimeType);

  return `users/${params.userId}/photos/starter/${params.photoSetId}/${params.position}.${ext}`;
}

export async function createSignedPhotoUploadUrl(params: {
  storageKey: string;
  mimeType: string;
  expiresInSeconds?: number;
}) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: params.storageKey,
    ContentType: params.mimeType
  });

  const uploadUrl = await getSignedUrl(r2Client, command, {
    expiresIn: params.expiresInSeconds ?? 300
  });

  return uploadUrl;
}

export async function createSignedPhotoViewUrl(params: {
  storageKey: string;
  expiresInSeconds?: number;
}) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: params.storageKey
  });

  const viewUrl = await getSignedUrl(r2Client, command, {
    expiresIn: params.expiresInSeconds ?? 300
  });

  return viewUrl;
}

export function buildProgressPhotoStorageKey(params: {
  userId: string;
  photoSetId: string;
  position: PhotoPosition;
  mimeType: string;
}) {
  const ext = getPhotoExtensionFromMimeType(params.mimeType);

  return `users/${params.userId}/photos/progress/${params.photoSetId}/${params.position}.${ext}`;
}
