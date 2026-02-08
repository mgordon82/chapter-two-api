import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { planRouter } from './routes/plan';
import { analyzeLimiter, analyzeFailsafe } from './middleware/analyzeRateLimit';

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
app.listen(PORT, () => {
  console.log(`Chapter Two backend listening on port ${PORT}`);
});
