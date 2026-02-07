import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

export const analyzeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Too many analysis requests from this IP. Please wait a few minutes and try again.'
  }
});

const HOURLY_LIMIT = 200;
const WINDOW_MS = 60 * 60 * 1000;

let windowStart = Date.now();
let callsThisWindow = 0;

export function analyzeFailsafe(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const now = Date.now();

  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    callsThisWindow = 0;
  }

  if (callsThisWindow >= HOURLY_LIMIT) {
    return res.status(503).json({
      error:
        'Analysis temporarily unavailable due to high usage. Please try again later.'
    });
  }

  callsThisWindow += 1;
  return next();
}
