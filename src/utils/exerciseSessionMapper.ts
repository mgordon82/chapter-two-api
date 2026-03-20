import { ObjectId } from 'mongodb';

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

export type MappedExerciseSession = {
  id: string;
  userId: string;

  performedAt: string | null;
  localDateKey: string | null;
  startedAt: string | null;
  endedAt: string | null;

  source: {
    type: string | null;
    integration: string | null;
    externalId: string | null;
    importedAt: string | null;
  };

  sessionType: string | null;
  name: string | null;
  notes: string | null;

  metrics: {
    durationMinutes: number | null;
    caloriesBurned: number | null;
    distanceMeters: number | null;
    stepCount: number | null;
  };

  links: {
    plannedWorkoutId: string | null;
    completedWorkoutId: string | null;
  };

  createdAt: string | null;
  updatedAt: string | null;

  raw: unknown;
};

export function mapExerciseSession(doc: AnyDoc): MappedExerciseSession {
  return {
    id: toId(doc?._id) ?? '',
    userId: toId(doc?.userId) ?? '',

    performedAt: toIso(doc?.performedAt),
    localDateKey: toStringOrNull(doc?.localDateKey),
    startedAt: toIso(doc?.startedAt),
    endedAt: toIso(doc?.endedAt),

    source: {
      type: toStringOrNull(doc?.source?.type),
      integration: toStringOrNull(doc?.source?.integration),
      externalId: toStringOrNull(doc?.source?.externalId),
      importedAt: toIso(doc?.source?.importedAt)
    },

    sessionType: toStringOrNull(doc?.sessionType),
    name: toStringOrNull(doc?.name),
    notes: toStringOrNull(doc?.notes),

    metrics: {
      durationMinutes: toNumberOrNull(doc?.metrics?.durationMinutes),
      caloriesBurned: toNumberOrNull(doc?.metrics?.caloriesBurned),
      distanceMeters: toNumberOrNull(doc?.metrics?.distanceMeters),
      stepCount: toNumberOrNull(doc?.metrics?.stepCount)
    },

    links: {
      plannedWorkoutId: toId(doc?.links?.plannedWorkoutId),
      completedWorkoutId: toId(doc?.links?.completedWorkoutId)
    },

    createdAt: toIso(doc?.createdAt),
    updatedAt: toIso(doc?.updatedAt),

    raw: doc
  };
}

export function mapExerciseSessions(docs: AnyDoc[]): MappedExerciseSession[] {
  return docs.map(mapExerciseSession);
}
