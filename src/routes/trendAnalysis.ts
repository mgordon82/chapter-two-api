import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { ObjectId } from 'mongodb';

import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { requireAppUser } from '../middleware/requireAppUser';
import { getDb } from '../config/db';

import { openai } from '../config/openai';
import { zodTextFormat } from 'openai/helpers/zod';

export const trendAnalysisRouter = Router();

const analyzeReqSchema = z.object({
  range: z.enum(['1W', '1M', '3M', '6M', '12M']).default('3M')
});

type RangeKey = z.infer<typeof analyzeReqSchema>['range'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type CheckInRow = {
  recordedAt: Date;
  weightKg: number;
};

type TrendStatus = 'ok' | 'insufficient_data';
type TrendConfidence = 'low' | 'medium' | 'high';

type TrendOption = {
  id: string;
  kind: 'hold' | 'activity_bump' | 'macro_tweak';
  title: string;
  summary: string;
};

type TrendMetricsResponse = {
  requestId: string;
  range: RangeKey;
  status: TrendStatus;
  confidence: TrendConfidence;
  series: { date: string; weightKg: number }[];
  windows: null | {
    last7: { start: string; end: string; n: number };
    prev7: { start: string; end: string; n: number };
  };
  metrics: {
    currentWeightKg: number | null;
    avgLast7dKg: number | null;
    avgPrev7dKg: number | null;
    avgChangePerWeekKg: number | null;
    avgChangePerWeekPct: number | null;
  };
};

type DeterministicTrendAnalysis = Omit<TrendMetricsResponse, 'requestId'> & {
  options: TrendOption[];
};

function daysForRange(range: RangeKey): number {
  switch (range) {
    case '1W':
      return 7;
    case '1M':
      return 35;
    case '3M':
      return 110;
    case '6M':
      return 220;
    case '12M':
      return 430;
    default:
      return 35;
  }
}

function startOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function isoDayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dedupeLatestPerDay(rows: CheckInRow[]): CheckInRow[] {
  const map = new Map<string, CheckInRow>();

  for (const r of rows) {
    const key = isoDayKey(r.recordedAt);
    const existing = map.get(key);
    if (!existing || r.recordedAt > existing.recordedAt) {
      map.set(key, r);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()
  );
}

function computeRolling7dAverages(rows: CheckInRow[], anchorDateUtc: Date) {
  const anchorStart = startOfDayUTC(anchorDateUtc);
  const last7Start = new Date(anchorStart.getTime() - 6 * MS_PER_DAY);
  const prev7End = new Date(last7Start.getTime() - 1);
  const prev7Start = new Date(
    startOfDayUTC(new Date(prev7End)).getTime() - 6 * MS_PER_DAY
  );

  const last7 = rows
    .filter((r) => r.recordedAt >= last7Start && r.recordedAt <= anchorStart)
    .map((r) => r.weightKg);

  const prev7 = rows
    .filter((r) => r.recordedAt >= prev7Start && r.recordedAt < last7Start)
    .map((r) => r.weightKg);

  const avgLast7 = mean(last7);
  const avgPrev7 = mean(prev7);

  const avgChangePerWeekKg =
    avgLast7 != null && avgPrev7 != null ? avgLast7 - avgPrev7 : null;

  const avgChangePerWeekPct =
    avgLast7 != null && avgPrev7 != null && avgPrev7 > 0
      ? ((avgLast7 - avgPrev7) / avgPrev7) * 100
      : null;

  return {
    windows: {
      last7: { start: last7Start, end: anchorStart, n: last7.length },
      prev7: {
        start: prev7Start,
        end: new Date(last7Start.getTime() - 1),
        n: prev7.length
      }
    },
    avgLast7dKg: avgLast7,
    avgPrev7dKg: avgPrev7,
    avgChangePerWeekKg,
    avgChangePerWeekPct
  };
}

function confidenceFromSampleSize(
  nLast7: number,
  nPrev7: number
): TrendConfidence {
  const minN = Math.min(nLast7, nPrev7);
  if (minN < 4) return 'low';
  if (minN < 6) return 'medium';
  return 'high';
}

function buildTrendOptions(
  status: TrendStatus,
  avgChangePerWeekKg: number | null
): TrendOption[] {
  if (status === 'insufficient_data') {
    return [
      {
        id: 'add_checkins',
        kind: 'hold',
        title: 'Add more check-ins',
        summary: 'Log 4–7 weigh-ins/week to unlock reliable trend analysis.'
      },
      {
        id: 'hold',
        kind: 'hold',
        title: 'Hold current plan',
        summary:
          'Keep your plan steady while you collect more consistent weigh-in data.'
      }
    ];
  }

  if (avgChangePerWeekKg == null) {
    return [
      {
        id: 'hold',
        kind: 'hold',
        title: 'Hold current plan',
        summary: 'Keep your plan steady and reassess after 7–10 more check-ins.'
      }
    ];
  }

  // Losing too fast
  if (avgChangePerWeekKg < -0.75) {
    return [
      {
        id: 'hold',
        kind: 'hold',
        title: 'Hold current plan',
        summary:
          'Your trend is moving down quickly — avoid making the plan more aggressive right now.'
      },
      {
        id: 'macro_tweak_recover',
        kind: 'macro_tweak',
        title: 'Slight calorie increase',
        summary:
          'If energy, hunger, or recovery feel rough, increase intake slightly for 7–10 days.'
      },
      {
        id: 'activity_hold',
        kind: 'hold',
        title: 'Do not add more activity yet',
        summary:
          'Keep activity steady until the trend settles into a more sustainable pace.'
      }
    ];
  }

  // Solid downward trend
  if (avgChangePerWeekKg < -0.25) {
    return [
      {
        id: 'hold',
        kind: 'hold',
        title: 'Hold current plan',
        summary:
          'Your trend is moving in the right direction — keep your current approach steady.'
      },
      {
        id: 'activity_bump_2k',
        kind: 'activity_bump',
        title: 'Optional activity bump',
        summary:
          'Only if energy is good, add ~2,000 steps/day as a short experiment.'
      }
    ];
  }

  // Plateau / nearly flat
  if (Math.abs(avgChangePerWeekKg) < 0.05) {
    return [
      {
        id: 'activity_bump_2k',
        kind: 'activity_bump',
        title: 'Activity bump (10-day experiment)',
        summary: 'Add ~2,000 steps/day average for 10 days and reassess.'
      },
      {
        id: 'macro_tweak_small',
        kind: 'macro_tweak',
        title: 'Small calorie adjustment',
        summary: 'Reduce daily intake by ~150 calories for 10–14 days.'
      },
      {
        id: 'hold',
        kind: 'hold',
        title: 'Hold steady a bit longer',
        summary:
          'If consistency has been uneven, stay steady for another week before adjusting.'
      }
    ];
  }

  // Gaining
  if (avgChangePerWeekKg > 0.15) {
    return [
      {
        id: 'activity_bump_2k',
        kind: 'activity_bump',
        title: 'Increase activity slightly',
        summary: 'Add ~2,000 steps/day and reassess trend after 10 days.'
      },
      {
        id: 'macro_tweak_small',
        kind: 'macro_tweak',
        title: 'Small calorie adjustment',
        summary: 'Reduce daily intake by ~150 calories for the next 10–14 days.'
      },
      {
        id: 'hold',
        kind: 'hold',
        title: 'Audit consistency first',
        summary:
          'Before making a bigger change, tighten tracking and weigh-in consistency for one week.'
      }
    ];
  }

  // Mild downward trend / basically fine
  return [
    {
      id: 'hold',
      kind: 'hold',
      title: 'Hold current plan',
      summary: 'Your trend looks stable — continue and reassess next week.'
    },
    {
      id: 'activity_bump_2k',
      kind: 'activity_bump',
      title: 'Small activity boost',
      summary:
        'If progress feels slower than expected, add ~2,000 steps/day for 7–10 days.'
    }
  ];
}

async function analyzeTrendForUser(
  userObjectId: ObjectId,
  range: RangeKey
): Promise<DeterministicTrendAnalysis> {
  const db = getDb();
  const checkIns = db.collection('checkIns');

  const now = new Date();
  const start = new Date(now.getTime() - daysForRange(range) * MS_PER_DAY);

  const docs = await checkIns
    .find(
      {
        userId: userObjectId,
        isDeleted: false,
        'metrics.weightKg': { $type: 'number' },
        recordedAt: { $gte: start, $lte: now }
      },
      { projection: { recordedAt: 1, 'metrics.weightKg': 1 } }
    )
    .sort({ recordedAt: 1 })
    .toArray();

  const rowsRaw: CheckInRow[] = docs.map((d: any) => ({
    recordedAt: new Date(d.recordedAt),
    weightKg: Number(d.metrics?.weightKg)
  }));

  const rows = dedupeLatestPerDay(rowsRaw);
  const latest = rows.length ? rows[rows.length - 1] : null;

  if (!latest) {
    const status: TrendStatus = 'insufficient_data';

    return {
      range,
      status,
      confidence: 'low',
      series: [],
      windows: null,
      metrics: {
        currentWeightKg: null,
        avgLast7dKg: null,
        avgPrev7dKg: null,
        avgChangePerWeekKg: null,
        avgChangePerWeekPct: null
      },
      options: buildTrendOptions(status, null)
    };
  }

  const rolling = computeRolling7dAverages(rows, latest.recordedAt);

  const status: TrendStatus =
    rolling.avgLast7dKg == null || rolling.avgPrev7dKg == null
      ? 'insufficient_data'
      : 'ok';

  const confidence = confidenceFromSampleSize(
    rolling.windows.last7.n,
    rolling.windows.prev7.n
  );

  return {
    range,
    status,
    confidence,
    series: rows.map((r) => ({
      date: r.recordedAt.toISOString(),
      weightKg: Number(r.weightKg.toFixed(2))
    })),
    windows: {
      last7: {
        start: rolling.windows.last7.start.toISOString(),
        end: rolling.windows.last7.end.toISOString(),
        n: rolling.windows.last7.n
      },
      prev7: {
        start: rolling.windows.prev7.start.toISOString(),
        end: rolling.windows.prev7.end.toISOString(),
        n: rolling.windows.prev7.n
      }
    },
    metrics: {
      currentWeightKg: Number(latest.weightKg.toFixed(2)),
      avgLast7dKg:
        rolling.avgLast7dKg != null
          ? Number(rolling.avgLast7dKg.toFixed(2))
          : null,
      avgPrev7dKg:
        rolling.avgPrev7dKg != null
          ? Number(rolling.avgPrev7dKg.toFixed(2))
          : null,
      avgChangePerWeekKg:
        rolling.avgChangePerWeekKg != null
          ? Number(rolling.avgChangePerWeekKg.toFixed(2))
          : null,
      avgChangePerWeekPct:
        rolling.avgChangePerWeekPct != null
          ? Number(rolling.avgChangePerWeekPct.toFixed(3))
          : null
    },
    options: buildTrendOptions(status, rolling.avgChangePerWeekKg)
  };
}

const trendAiResponseSchema = z.object({
  quickRead: z.string().max(140),
  context: z.string().max(200).nullable(),
  recommended: z
    .array(
      z.object({
        id: z.string().max(40),
        title: z.string().max(60),
        summary: z.string().max(160),
        rationale: z.string().max(160)
      })
    )
    .min(1)
    .max(3),
  disclaimer: z.string().max(160).nullable()
});

type TrendAiResponse = z.infer<typeof trendAiResponseSchema>;

type TrendInsightResponse = {
  requestId: string;
  range: RangeKey;
  status: TrendStatus;
  confidence: TrendConfidence;
  options: TrendOption[];
  ai: TrendAiResponse | null;
};

const trendAiSystemPrompt = `
You are a fitness coaching assistant.

You will be given:
- trend analysis results
- an array of allowed options (each has id/title/summary/kind)

Your job:
- Write a short "quickRead" (<=140 chars)
- Pick the best 1–3 options from the provided list (do not invent new options)
- For each recommended option: provide a short rationale
- If status is "insufficient_data" OR confidence is "low", prioritize consistency + more check-ins.

Rules:
- Do not do math; treat input numbers as correct.
- Do not mention internal ids except in the "id" field.
- Return JSON matching the schema exactly.
`.trim();

async function getAiRecommendations(input: {
  range: RangeKey;
  status: TrendStatus;
  confidence: TrendConfidence;
  windows: TrendMetricsResponse['windows'];
  metrics: TrendMetricsResponse['metrics'];
  options: TrendOption[];
}): Promise<TrendAiResponse> {
  const allowedIds = input.options.map((o) => o.id);

  const resp = await openai.responses.parse({
    model: 'gpt-5.1',
    input: [
      { role: 'system', content: trendAiSystemPrompt },
      {
        role: 'user',
        content: JSON.stringify({
          range: input.range,
          status: input.status,
          confidence: input.confidence,
          windows: input.windows,
          metrics: input.metrics,
          options: input.options,
          allowedOptionIds: allowedIds
        })
      }
    ],
    reasoning: { effort: 'low' },
    max_output_tokens: 450,
    text: { format: zodTextFormat(trendAiResponseSchema, 'TrendAI') }
  });

  const out = resp.output_parsed;
  if (!out) throw new Error('AI returned no parsed output');

  const allowed = new Set(allowedIds);
  const filtered = out.recommended.filter((r) => allowed.has(r.id));

  if (!filtered.length) {
    const first = input.options[0];
    return {
      quickRead:
        input.status === 'ok'
          ? 'Here’s your next best step.'
          : 'Add a few more check-ins to improve confidence.',
      context: null,
      disclaimer: null,
      recommended: [
        {
          id: first.id,
          title: first.title,
          summary: first.summary,
          rationale:
            input.status === 'ok'
              ? 'This is the most reliable next move based on your current signal.'
              : 'More consistent data will make recommendations more accurate.'
        }
      ]
    };
  }

  return { ...out, recommended: filtered.slice(0, 3) };
}

function getRequestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getUserObjectId(req: any): ObjectId {
  const userId = req.user?._id as ObjectId | string | undefined;
  if (!userId) {
    throw new Error('MISSING_USER');
  }
  return typeof userId === 'string' ? new ObjectId(userId) : userId;
}

trendAnalysisRouter.post(
  '/metrics',
  requireCognitoAuth,
  requireAppUser,
  async (req, res): Promise<void> => {
    const requestId = getRequestId();
    res.setHeader('x-request-id', requestId);

    try {
      const parsed = analyzeReqSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request body',
          requestId,
          details: parsed.error.flatten()
        });
        return;
      }

      let userObjectId: ObjectId;
      try {
        userObjectId = getUserObjectId(req);
      } catch {
        res.status(500).json({
          error: 'Missing user on request',
          requestId
        });
        return;
      }

      const analysis = await analyzeTrendForUser(
        userObjectId,
        parsed.data.range
      );

      const response: TrendMetricsResponse = {
        requestId,
        range: analysis.range,
        status: analysis.status,
        confidence: analysis.confidence,
        series: analysis.series,
        windows: analysis.windows,
        metrics: analysis.metrics
      };

      res.json(response);
      return;
    } catch (err: any) {
      console.error('[TREND_METRICS] error', {
        requestId,
        message: err?.message,
        stack: err?.stack
      });

      res.status(500).json({
        error: 'Trend metrics failed',
        requestId
      });
      return;
    }
  }
);

trendAnalysisRouter.post(
  '/insight',
  requireCognitoAuth,
  requireAppUser,
  async (req, res): Promise<void> => {
    const requestId = getRequestId();
    res.setHeader('x-request-id', requestId);

    try {
      const parsed = analyzeReqSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request body',
          requestId,
          details: parsed.error.flatten()
        });
        return;
      }

      let userObjectId: ObjectId;
      try {
        userObjectId = getUserObjectId(req);
      } catch {
        res.status(500).json({
          error: 'Missing user on request',
          requestId
        });
        return;
      }

      const analysis = await analyzeTrendForUser(
        userObjectId,
        parsed.data.range
      );

      let ai: TrendAiResponse | null = null;
      try {
        ai = await getAiRecommendations({
          range: analysis.range,
          status: analysis.status,
          confidence: analysis.confidence,
          windows: analysis.windows,
          metrics: analysis.metrics,
          options: analysis.options
        });
      } catch (err: any) {
        console.error('[TREND_INSIGHT_AI] failed', {
          requestId,
          message: err?.message,
          stack: err?.stack
        });
        ai = null;
      }

      const response: TrendInsightResponse = {
        requestId,
        range: analysis.range,
        status: analysis.status,
        confidence: analysis.confidence,
        options: analysis.options,
        ai
      };

      res.json(response);
      return;
    } catch (err: any) {
      console.error('[TREND_INSIGHT] error', {
        requestId,
        message: err?.message,
        stack: err?.stack
      });

      res.status(500).json({
        error: 'Trend insight failed',
        requestId
      });
      return;
    }
  }
);
