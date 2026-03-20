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

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export type MappedCoachSummary = {
  id: string;
  userId: string;
  coachUserId: string;

  periodType: 'day' | 'week' | 'month' | 'quarter' | 'year' | null;
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;

  relatedCheckInId: string | null;

  title: string | null;
  summary: string | null;

  visibleToUser: boolean;

  createdAt: string | null;
  updatedAt: string | null;

  raw: unknown;
};

export function mapCoachSummary(doc: AnyDoc): MappedCoachSummary {
  const periodType =
    doc?.periodType === 'day' ||
    doc?.periodType === 'week' ||
    doc?.periodType === 'month' ||
    doc?.periodType === 'quarter' ||
    doc?.periodType === 'year'
      ? doc.periodType
      : null;

  return {
    id: toId(doc?._id) ?? '',
    userId: toId(doc?.userId) ?? '',
    coachUserId: toId(doc?.coachUserId) ?? '',

    periodType,
    periodKey: toStringOrNull(doc?.periodKey),
    periodStart: toIso(doc?.periodStart),
    periodEnd: toIso(doc?.periodEnd),

    relatedCheckInId: toId(doc?.relatedCheckInId),

    title: toStringOrNull(doc?.title),
    summary: toStringOrNull(doc?.summary),

    visibleToUser: Boolean(doc?.visibleToUser),

    createdAt: toIso(doc?.createdAt),
    updatedAt: toIso(doc?.updatedAt),

    raw: doc
  };
}

export function mapCoachSummaries(docs: AnyDoc[]): MappedCoachSummary[] {
  return docs.map(mapCoachSummary);
}
