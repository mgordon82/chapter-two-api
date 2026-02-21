import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri) throw new Error('Missing MONGODB_URI');
  if (!dbName) throw new Error('Missing MONGODB_DB');

  client = new MongoClient(uri);
  await client.connect();

  db = client.db(dbName);

  // Helpful indexes
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db
    .collection('users')
    .createIndex({ 'auth.cognitoSub': 1 }, { unique: true, sparse: true });

  return db;
}

export function getDb(): Db {
  if (!db)
    throw new Error('Mongo not connected. Call connectMongo() at startup.');
  return db;
}
