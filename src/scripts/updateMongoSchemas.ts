import 'dotenv/config';
import { connectMongo, getDb } from '../config/db';

async function main() {
  // ✅ ensure DB is connected first
  await connectMongo();
  const db = getDb();

  console.log('Connected to Mongo. Updating schemas...');

  // --- Update checkIns validator ---
  await db.command({
    collMod: 'checkIns',
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: [
          '_id',
          'userId',
          'createdAt',
          'createdByUserId',
          'isDeleted'
        ],
        properties: {
          _id: { bsonType: 'objectId' },
          userId: { bsonType: 'objectId' },

          createdAt: { bsonType: 'date' },
          createdByUserId: { bsonType: 'objectId' },
          updatedAt: { bsonType: ['date', 'null'] },
          updatedByUserId: { bsonType: ['objectId', 'null'] },

          isDeleted: { bsonType: 'bool' },
          deletedAt: { bsonType: ['date', 'null'] },
          deletedByUserId: { bsonType: ['objectId', 'null'] },

          recordedAt: { bsonType: ['date', 'null'] },

          // legacy support
          hasPhotos: { bsonType: ['bool', 'null'] },
          photos: { bsonType: ['object', 'null'] },

          metrics: {
            bsonType: ['object', 'null'],
            properties: {
              notes: { bsonType: ['string', 'null'] },
              weightKg: { bsonType: ['double', 'int', 'long', 'null'] }
            }
          },

          // new model
          schemaVersion: { bsonType: ['int', 'null'] },

          periodType: {
            bsonType: ['string', 'null'],
            enum: ['day', 'week', 'month', 'quarter', 'year', null]
          },
          periodKey: { bsonType: ['string', 'null'] },
          periodStart: { bsonType: ['date', 'null'] },
          periodEnd: { bsonType: ['date', 'null'] },
          representedDate: { bsonType: ['date', 'null'] },

          status: {
            bsonType: ['string', 'null'],
            enum: ['open', 'closed', null]
          },
          manualEditWindowEndsAt: { bsonType: ['date', 'null'] },
          closedAt: { bsonType: ['date', 'null'] },
          closedByUserId: { bsonType: ['objectId', 'null'] },

          sections: { bsonType: ['object', 'null'] },

          coachFeedback: { bsonType: ['object', 'null'] }
        }
      }
    },
    validationLevel: 'moderate'
  });

  console.log('✅ checkIns validator updated');

  // --- Create collections if missing ---
  const existing = await db.listCollections().toArray();
  const names = new Set(existing.map((c) => c.name));

  if (!names.has('exerciseSessions')) {
    await db.createCollection('exerciseSessions');
    console.log('✅ Created exerciseSessions');
  }

  if (!names.has('coachSummaries')) {
    await db.createCollection('coachSummaries');
    console.log('✅ Created coachSummaries');
  }

  // --- Indexes ---
  await db
    .collection('exerciseSessions')
    .createIndex(
      { userId: 1, localDateKey: 1 },
      { name: 'exerciseSessions_userId_localDateKey' }
    );

  await db
    .collection('exerciseSessions')
    .createIndex(
      { userId: 1, performedAt: 1 },
      { name: 'exerciseSessions_userId_performedAt' }
    );

  await db
    .collection('coachSummaries')
    .createIndex(
      { userId: 1, coachUserId: 1, periodType: 1, periodKey: 1 },
      { name: 'coachSummaries_user_coach_period' }
    );

  console.log('✅ Indexes ensured');

  console.log('🎉 Mongo schema update complete');
}

main().catch((err) => {
  console.error('❌ Mongo schema update failed:', err);
  process.exit(1);
});
