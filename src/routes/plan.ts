import { Router } from 'express';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai, OPENAI_MODEL } from '../config/openai';

export const planRouter = Router();

const mealPlanRequestSchema = z.object({
  planText: z
    .string()
    .transform((s) => s.trim())
    .refine(
      (s) => s.length >= 5,
      'Please enter your macros and any restrictions.'
    )
});

type MealPlanRequest = z.infer<typeof mealPlanRequestSchema>;

const macroTotalsSchema = z.object({
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0)
});

const mealPlanResponseSchema = z.object({
  assumptions: z.object({
    mealsPerDay: z.number().int().min(1).max(8),
    notes: z.string().max(200)
  }),
  dailyTargets: macroTotalsSchema,
  meals: z
    .array(
      z.object({
        name: z.string().max(60),
        mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
        description: z.string().max(120),
        portionGuidance: z.string().max(160),
        estimatedMacros: macroTotalsSchema,
        swapOptions: z.array(z.string().max(80)).max(2).default([])
      })
    )
    .length(4),
  notes: z.string().max(200)
});

type MealPlanResponse = z.infer<typeof mealPlanResponseSchema>;

const systemPrompt = `
You are Chapter Two AI. Create meal ideas that fit the user's macro targets and any dietary restrictions/preferences mentioned.

Rules:
- Output ONLY a single JSON object that matches the provided schema. No extra keys. No markdown.
- Use everyday foods. Keep meals simple and realistic.
- Macro numbers are rough estimates, not exact calculations.
- Do not give medical advice or guarantee outcomes.
- If key information is missing, make reasonable assumptions and write them in assumptions.notes. Do NOT ask questions.

OUTPUT CONSTRAINTS (MUST FOLLOW):
- Return exactly 4 meals total: breakfast, lunch, dinner, snack (one each).
- description: 1 sentence, keep it short.
- Keep portionGuidance brief.
- swapOptions: 0–2 items per meal.
- Keep assumptions.notes and notes short.
- Output ONLY valid JSON. No extra text.
`.trim();

planRouter.post('/analyze', async (req, res) => {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  req.on('aborted', () => console.log(`[PLAN:${requestId}] req_aborted`));
  res.on('close', () => {
    // Only useful if you want to see abnormal closes; remove if noisy
    // finished=true generally means normal close after response
    // console.log(`[PLAN:${requestId}] res_close finished=${res.writableEnded}`);
  });

  const parsedReq = mealPlanRequestSchema.safeParse(req.body);
  if (!parsedReq.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      requestId,
      details: parsedReq.error.flatten()
    });
  }

  const { planText } = parsedReq.data as MealPlanRequest;

  try {
    const t0 = Date.now();

    const response = await openai.responses.parse({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: planText }
      ],
      reasoning: { effort: 'minimal' },
      max_output_tokens: 2000,
      text: {
        format: zodTextFormat(mealPlanResponseSchema, 'ChapterTwoMealPlan')
      }
    });

    const plan = response.output_parsed as MealPlanResponse | null;

    if (!plan) {
      console.error(`[PLAN:${requestId}] parse_failed output_parsed is null`);
      res.setHeader('x-request-id', requestId);
      return res.status(502).json({
        error: 'AI returned an unexpected format. Please try again.',
        requestId
      });
    }

    console.log(
      `[PLAN:${requestId}] ok openai_ms=${Date.now() - t0} meals=${
        plan.meals.length
      } targets=${plan.dailyTargets.calories}kcal`
    );

    res.setHeader('x-request-id', requestId);
    return res.json(plan);
  } catch (err: any) {
    console.error(`[PLAN:${requestId}] error=`, err?.response ?? err);
    res.setHeader('x-request-id', requestId);
    return res.status(500).json({
      error: 'Failed to generate meal plan at this time.',
      requestId
    });
  }
});
