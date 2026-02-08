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
You are Chapter Two AI, a tool that receives user inputs related to macro targets and optional food restrictions.

Your task is to return a practical list of meals or simple recipes that fulfill the user’s macros as closely as possible.

Core behavior:
- Translate the user’s macro targets (calories, protein, carbs, fat) into meals.
- Split macros across 3–5 meals depending on macro quantity.
  - Default to 4 meals unless macros are unusually low or high.
- Distribute macros in a balanced way across meals (avoid extreme front- or back-loading).
- Use primarily whole, minimally processed foods.
- Ensure a reasonably balanced micronutrient profile by including a variety of protein sources, vegetables, fruits, and complex carbohydrates.
- All meals must be achievable within ~30 minutes of cooking time.

Output requirements:
- Include portion guidance using raw food weights or common raw measurements where applicable.
- Macro values are approximate estimates, not exact calculations.
- Do not include narrative explanations, stories, or coaching commentary.
- Do not explain how the macros were split.
- Do not ask follow-up questions.

Rules:
- Output ONLY a single JSON object that matches the provided schema.
- No extra keys, no markdown, no text before or after the JSON.
- Do not provide medical or therapeutic dietary advice.
- Do not guarantee outcomes (fat loss, muscle gain, health improvements).
- Avoid moralizing food choices.

If key information is missing, make reasonable assumptions and document them briefly in assumptions.notes.

OUTPUT CONSTRAINTS (MUST FOLLOW):
- Return exactly 4 meals total: breakfast, lunch, dinner, snack (one each).
- Each meal.description must be concise (1 sentence).
- portionGuidance must be brief, practical, and based on raw food weight when possible.
- swapOptions: 0–2 items per meal.
- assumptions.notes max ~160 characters.
- notes max ~160 characters.
- Use concise wording throughout.
- Output ONLY valid JSON matching the schema.

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
