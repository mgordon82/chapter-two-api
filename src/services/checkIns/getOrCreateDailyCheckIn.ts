import { Db, ObjectId } from 'mongodb';
import { getDayPeriod, getManualEditWindowEnd } from '../../utils/periods';

export async function getOrCreateDailyCheckIn(params: {
  db: Db;
  userId: ObjectId;
  targetDate: Date;
}) {
  const { db, userId, targetDate } = params;

  const checkIns = db.collection('checkIns');

  const now = new Date();

  const { periodType, periodKey, periodStart, periodEnd } =
    getDayPeriod(targetDate);

  // 🔍 Try to find existing check-in for that day
  const existing = await checkIns.findOne({
    userId,
    periodType: 'day',
    periodKey,
    isDeleted: false
  });

  if (existing) {
    return {
      checkIn: existing,
      created: false
    };
  }

  // 🆕 Create new check-in
  const manualEditWindowEndsAt = getManualEditWindowEnd({
    representedDate: targetDate,
    createdAt: now
  });

  const doc = {
    userId,

    schemaVersion: 2,
    periodType,
    periodKey,
    periodStart,
    periodEnd,
    representedDate: targetDate,
    status: 'open',
    manualEditWindowEndsAt,

    recordedAt: targetDate,

    metrics: {
      weightKg: null,
      notes: ''
    },

    hasPhotos: false,

    createdAt: now,
    createdByUserId: userId,
    updatedAt: null,
    isDeleted: false
  };

  const result = await checkIns.insertOne(doc);

  return {
    checkIn: {
      ...doc,
      _id: result.insertedId
    },
    created: true
  };
}
