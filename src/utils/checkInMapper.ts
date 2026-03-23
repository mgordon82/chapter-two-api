import { ObjectId } from 'mongodb';
import { isCheckInEditable } from './periods';

type AnyDoc = Record<string, any>;

function toId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof ObjectId) return value.toString();
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    const str = String((value as { toString: () => string }).toString());
    return str || null;
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mapLegacyPhotos(doc: AnyDoc) {
  const rawPhotos = Array.isArray(doc?.photos?.photos) ? doc.photos.photos : [];

  return rawPhotos.map((photo: AnyDoc) => ({
    position: toStringOrNull(photo?.position),
    storageKey: toStringOrNull(photo?.storageKey),
    mimeType: toStringOrNull(photo?.mimeType),
    originalFileName: toStringOrNull(photo?.originalFileName),
    sizeBytes: toNumberOrNull(photo?.sizeBytes),
    uploadedAt: toIso(photo?.uploadedAt),
    viewUrl: toStringOrNull(photo?.viewUrl)
  }));
}

function toYmdOrNull(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    return null;
  }

  return null;
}

export type MappedCheckIn = {
  id: string;
  userId: string;

  periodType: 'day' | 'week' | 'month' | 'quarter' | 'year' | null;
  periodKey: string | null;
  representedDate: string | null;
  recordedAt: string | null;
  displayDate: string | null;

  status: 'open' | 'closed' | null;
  manualEditWindowEndsAt: string | null;
  isEditable: boolean;
  lifecycleState: 'open' | 'closed' | 'expired';

  weightKg: number | null;
  weightSource: 'manual' | 'apple_health' | 'legacy' | null;
  hasWeightConflict: boolean;
  alternateWeights?: Array<{
    source: 'manual' | 'apple_health' | 'legacy';
    weightKg: number;
  }>;
  energyLevel: number | null;
  calories: number | null;
  proteinGrams: number | null;
  restingHeartRate: number | null;
  steps: number | null;
  totalExerciseMinutes: number | null;
  standGoal: number | null;
  notes: string | null;

  suggestedExerciseSessionIds: string[];
  includedExerciseSessionIds: string[];
  excludedExerciseSessionIds: string[];
  hasExerciseSelections: boolean;
  includedExerciseSessionCount: number;
  excludedExerciseSessionCount: number;

  hasNutrition: boolean;
  hasCoreDailyMetrics: boolean;
  hasAnyContent: boolean;

  photoSetId: string | null;
  hasPhotoSet: boolean;
  hasPhotos: boolean;
  photos: Array<{
    position: string | null;
    storageKey: string | null;
    mimeType: string | null;
    originalFileName: string | null;
    sizeBytes: number | null;
    uploadedAt: string | null;
    viewUrl?: string | null;
  }>;

  coachFeedback: {
    coachUserId: string;
    feedback: string;
    createdAt: string | null;
    updatedAt: string | null;
    visibleToUser: boolean;
  } | null;
  hasCoachFeedback: boolean;

  raw: unknown;
};

function toIdArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  return values
    .map((value) => toId(value))
    .filter((value): value is string => Boolean(value));
}

export function mapCheckIn(doc: AnyDoc): MappedCheckIn {
  const periodType =
    doc?.periodType === 'day' ||
    doc?.periodType === 'week' ||
    doc?.periodType === 'month' ||
    doc?.periodType === 'quarter' ||
    doc?.periodType === 'year'
      ? doc.periodType
      : null;

  const manualEditWindowEndsAtIso = toIso(doc?.manualEditWindowEndsAt);
  const manualEditWindowEndsAt = manualEditWindowEndsAtIso
    ? new Date(manualEditWindowEndsAtIso)
    : null;

  const isClosed = doc?.status === 'closed';

  const isExpired =
    !isClosed &&
    manualEditWindowEndsAt instanceof Date &&
    new Date() > manualEditWindowEndsAt;

  const lifecycleState: 'open' | 'closed' | 'expired' = isClosed
    ? 'closed'
    : isExpired
    ? 'expired'
    : 'open';

  const manualWeight =
    doc?.sections?.daily?.body?.weightKg?.overrideValue ?? null;
  const appleHealthWeight =
    doc?.sections?.daily?.body?.weightKg?.appleHealth?.value ?? null;
  const legacyWeight = doc?.metrics?.weightKg ?? null;

  const weightKg = toNumberOrNull(
    manualWeight != null
      ? manualWeight
      : appleHealthWeight != null
      ? appleHealthWeight
      : legacyWeight
  );

  const weightSource: 'manual' | 'apple_health' | 'legacy' | null =
    manualWeight != null &&
    appleHealthWeight != null &&
    Number(manualWeight) === Number(appleHealthWeight)
      ? 'apple_health'
      : manualWeight != null
      ? 'manual'
      : appleHealthWeight != null
      ? 'apple_health'
      : legacyWeight != null
      ? 'legacy'
      : null;

  const hasWeightConflict =
    manualWeight != null &&
    appleHealthWeight != null &&
    Number(manualWeight) !== Number(appleHealthWeight);

  const newStyleNotes = doc?.sections?.daily?.notes?.userNotes ?? null;
  const legacyNotes = doc?.metrics?.notes ?? null;
  const notes = toStringOrNull(newStyleNotes ?? legacyNotes);

  const photoSetId = toId(doc?.sections?.daily?.photos?.photoSetId);

  const legacyPhotos = mapLegacyPhotos(doc);
  const hasLegacyPhotos = legacyPhotos.length > 0;
  const hasPhotos = Boolean(photoSetId || doc?.hasPhotos || hasLegacyPhotos);

  const coachFeedback =
    doc?.coachFeedback &&
    typeof doc.coachFeedback === 'object' &&
    doc.coachFeedback.feedback
      ? {
          coachUserId: toId(doc.coachFeedback.coachUserId) ?? '',
          feedback: String(doc.coachFeedback.feedback),
          createdAt: toIso(doc.coachFeedback.createdAt),
          updatedAt: toIso(doc.coachFeedback.updatedAt),
          visibleToUser: Boolean(doc.coachFeedback.visibleToUser)
        }
      : null;

  const suggestedExerciseSessionIds = toIdArray(
    doc?.sections?.daily?.exercise?.autoSuggestedExerciseSessionIds
  );

  const includedExerciseSessionIds = toIdArray(
    doc?.sections?.daily?.exercise?.includedExerciseSessionIds
  );

  const excludedExerciseSessionIds = toIdArray(
    doc?.sections?.daily?.exercise?.excludedExerciseSessionIds
  );

  const energyLevel = toNumberOrNull(
    doc?.sections?.daily?.recovery?.energyLevel
  );

  const calories = toNumberOrNull(
    doc?.sections?.daily?.nutrition?.calories?.value
  );

  const proteinGrams = toNumberOrNull(
    doc?.sections?.daily?.nutrition?.proteinGrams?.value
  );

  const restingHeartRate = toNumberOrNull(
    doc?.sections?.daily?.recovery?.restingHeartRate?.overrideValue
  );

  const steps = toNumberOrNull(
    doc?.sections?.daily?.activity?.steps?.overrideValue
  );

  const totalExerciseMinutes = toNumberOrNull(
    doc?.sections?.daily?.activity?.totalExerciseMinutes?.overrideValue
  );

  const standGoal = toNumberOrNull(
    doc?.sections?.daily?.activity?.standGoal?.overrideValue
  );

  const hasExerciseSelections =
    suggestedExerciseSessionIds.length > 0 ||
    includedExerciseSessionIds.length > 0 ||
    excludedExerciseSessionIds.length > 0;

  const includedExerciseSessionCount = includedExerciseSessionIds.length;
  const excludedExerciseSessionCount = excludedExerciseSessionIds.length;

  const hasPhotoSet = Boolean(photoSetId);

  const hasCoachFeedback = Boolean(
    coachFeedback &&
      typeof coachFeedback.feedback === 'string' &&
      coachFeedback.feedback.trim().length > 0
  );

  const recordedAt = toIso(doc?.recordedAt);

  const representedDate =
    toYmdOrNull(doc?.representedDate) ??
    (recordedAt ? recordedAt.slice(0, 10) : null);

  const displayDate = representedDate;

  const hasNutrition = calories !== null || proteinGrams !== null;

  const hasCoreDailyMetrics =
    weightKg !== null ||
    energyLevel !== null ||
    restingHeartRate !== null ||
    steps !== null ||
    totalExerciseMinutes !== null ||
    standGoal !== null ||
    hasNutrition;

  const hasAnyContent =
    hasCoreDailyMetrics ||
    Boolean(notes && notes.trim().length > 0) ||
    hasExerciseSelections ||
    hasPhotoSet ||
    hasCoachFeedback;

  return {
    id: toId(doc?._id) ?? '',
    userId: toId(doc?.userId) ?? '',

    periodType,
    periodKey: toStringOrNull(doc?.periodKey),
    representedDate,
    recordedAt,
    displayDate,

    status:
      doc?.status === 'open' || doc?.status === 'closed' ? doc.status : null,
    lifecycleState,

    manualEditWindowEndsAt: manualEditWindowEndsAtIso,
    isEditable: isCheckInEditable({
      status:
        doc?.status === 'open' || doc?.status === 'closed' ? doc.status : null,
      manualEditWindowEndsAt
    }),

    weightKg,
    weightSource,
    hasWeightConflict,
    energyLevel,
    calories,
    proteinGrams,
    restingHeartRate,
    steps,
    totalExerciseMinutes,
    standGoal,
    notes,

    suggestedExerciseSessionIds,
    includedExerciseSessionIds,
    excludedExerciseSessionIds,
    hasExerciseSelections,
    includedExerciseSessionCount,
    excludedExerciseSessionCount,

    hasNutrition,
    hasCoreDailyMetrics,
    hasAnyContent,

    photoSetId,
    hasPhotoSet,
    hasPhotos,
    photos: legacyPhotos,

    coachFeedback,
    hasCoachFeedback,

    raw: doc
  };
}

export function mapCheckIns(docs: AnyDoc[]): MappedCheckIn[] {
  return docs.map(mapCheckIn);
}
