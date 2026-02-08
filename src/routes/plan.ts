import { Router } from 'express';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai, OPENAI_MODEL } from '../config/openai';

export const planRouter = Router();

/**
 * Request schema
 */
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

/**
 * Response schema (AI output)
 */
const macroTotalsSchema = z.object({
  calories: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  fat: z.number().min(0)
});

const mealPlanResponseSchema = z.object({
  assumptions: z.object({
    mealsPerDay: z.number().int().min(1).max(8),
    notes: z.string()
  }),
  dailyTargets: macroTotalsSchema,
  meals: z
    .array(
      z.object({
        name: z.string(),
        mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
        description: z.string(),
        portionGuidance: z.string(),
        estimatedMacros: macroTotalsSchema,
        swapOptions: z.array(z.string()).default([])
      })
    )
    .min(1),
  notes: z.string()
});

type MealPlanResponse = z.infer<typeof mealPlanResponseSchema>;

/**
 * System prompt (tight + no contradictions)
 */
const systemPrompt = `
You are Chapter Two AI. Create meal ideas that fit the user's macro targets and any dietary restrictions/preferences mentioned.

Rules:
- Output ONLY a single JSON object that matches the provided schema. No extra keys. No markdown.
- Use everyday foods. Keep meals simple and realistic.
- Macro numbers are rough estimates, not exact calculations.
- Do not give medical advice or guarantee outcomes.

If key information is missing (e.g., meals per day), make reasonable assumptions and write them in assumptions.notes.
Do NOT ask questions.

Output size limits:
- Create a practical day plan with 3–5 meals total (include snacks only if it helps hit targets).
- swapOptions: 0–3 short items max per meal.
`.trim();

planRouter.post('/analyze', async (req, res) => {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  // Helpful: log body keys to catch mismatches fast
  console.log(`[PLAN:${requestId}] bodyKeys=`, Object.keys(req.body ?? {}));

  const parsedReq = mealPlanRequestSchema.safeParse(req.body);
  if (!parsedReq.success) {
    const details = parsedReq.error.flatten();
    console.log(`[PLAN:${requestId}] validation_failed=`, details);

    return res.status(400).json({
      error: 'Invalid request body',
      requestId,
      details
    });
  }

  const { planText } = parsedReq.data as MealPlanRequest;
  console.log(`[PLAN:${requestId}] planTextLength=${planText.length}`);

  try {
    const t0 = Date.now();

    const response = await openai.responses.parse({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        // ✅ send raw text, not JSON-wrapped payload
        { role: 'user', content: planText }
      ],
      // If your SDK supports it, uncomment to cap output:
      // max_output_tokens: 900,
      text: {
        format: zodTextFormat(mealPlanResponseSchema, 'ChapterTwoMealPlan')
      }
    });

    console.log(`[PLAN:${requestId}] openai_ms=${Date.now() - t0}`);

    const plan = response.output_parsed as MealPlanResponse;

    console.log(
      `[PLAN:${requestId}] ok meals=${plan.meals?.length ?? 0} targets=${
        plan.dailyTargets.calories
      }kcal`
    );
    res.setHeader('x-request-id', requestId);
    return res.json(plan);
  } catch (err: any) {
    // Log rich server-side, return safe client error
    console.error(`[PLAN:${requestId}] error=`, err?.response ?? err);

    return res.status(500).json({
      error: 'Failed to generate meal plan at this time.',
      requestId
    });
  }
});
