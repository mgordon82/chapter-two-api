import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { planRouter } from './routes/plan';
import { currentUserRouter } from './routes/currentUser';
import { analyzeLimiter, analyzeFailsafe } from './middleware/analyzeRateLimit';
import { connectMongo } from './config/db';
import { usersRouter } from './routes/users';
import { checkInsRouter } from './routes/userCheckins';
import { trendAnalysisRouter } from './routes/trendAnalysis';
import { photosRouter } from './routes/photos';
import { photoComparisonRouter } from './routes/photoComparison';
import { healthMetricsRouter } from './routes/healthMetrics';
import { clientProfileRouter } from './routes/clientProfile';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.path}`);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    console.log(
      `[RES] ${req.method} ${req.path} -> ${res.statusCode} (${
        Date.now() - start
      }ms)`
    );
  });

  res.on('close', () => {
    console.log(
      `[CLOSE] ${req.method} ${req.path} closed early after ${
        Date.now() - start
      }ms`
    );
  });

  next();
});

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Chapter Two API root. Try GET /api/health'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Chapter Two backend alive' });
});

app.use('/api/plan/analyze', analyzeLimiter, analyzeFailsafe);

app.use('/api/plan', planRouter);

app.use('/api/current-user', currentUserRouter);
app.use('/api/users', usersRouter);
app.use('/api/check-ins', checkInsRouter);
app.use('/api/trend', trendAnalysisRouter);
app.use('/api/photos', photosRouter);
app.use('/api/photo-comparison', photoComparisonRouter);
app.use('/api/health-metrics', healthMetricsRouter);
app.use('/api/clients', clientProfileRouter);

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
);
const PORT = process.env.PORT || 4000;

async function start() {
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`Chapter Two backend listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
