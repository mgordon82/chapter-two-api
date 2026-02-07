import { Router } from 'express';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { openai, OPENAI_MODEL } from '../config/openai';

export const mealRouter = Router();

/**
 * Request schema: macro-driven meal planning inputs
 * Keep it flexible + minimal for v1.
 */
const mealPlanRequestSchema = z.object({
  storyText: z.string().min(20, 'Story should be at least 20 characters.')
});

/**
 * Response schema: matches the JSON contract from your system prompt.
 */
const mealPlanResponseSchema = z.object({
  assumptions: z.object({
    mealsPerDay: z.number(),
    notes: z.string()
  }),
  dailyTargets: z.object({
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number()
  }),
  meals: z.array(
    z.object({
      name: z.string(),
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      description: z.string(),
      portionGuidance: z.string(),
      estimatedMacros: z.object({
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number()
      }),
      swapOptions: z.array(z.string()).default([])
    })
  ),
  notes: z.string()
});

type MealPlanRequest = z.infer<typeof mealPlanRequestSchema>;
type MealPlanResponse = z.infer<typeof mealPlanResponseSchema>;

const systemPrompt = `
You are Chapter Two AI, an assistant that helps users create meal plans or recipe ideas based on the macros they enter and any dietary restrictions or preferences.

Your role is to:
- Translate the user’s target macros (calories, protein, carbs, fats) into practical meal or recipe examples.
- Suggest rough portion sizes that reasonably fit those macros (approximate values are acceptable).
- Respect dietary restrictions, allergies, and food preferences provided by the user.
- Offer multiple options so the user can choose what best fits their taste and lifestyle.

Guidelines:
- Use realistic, everyday foods that are easy to prepare or commonly available.
- Macro estimates should be approximate, not exact.
- Prefer simple meals unless the user explicitly requests complex recipes.
- When useful, include small swaps or adjustments to raise or lower specific macros.

Constraints:
- Do not provide medical or therapeutic dietary advice.
- Do not guarantee outcomes (weight loss, muscle gain, health improvements).
- Avoid moralizing food choices.

Style & tone:
- Supportive, practical, and non-judgmental.
- Clear and concise.

If key information is missing (e.g., meals per day, cuisine preferences), make reasonable assumptions and note them briefly, or ask one clarifying question.

You must respond only with a single JSON object matching the schema you were given. Do not include prose, explanations, or formatting outside that JSON.
`.trim();

/**
 * POST /meal/plan
 * Body: MealPlanRequest
 * Returns: MealPlanResponse (+ optional metadata if you want later)
 */
mealRouter.post('/analyze', async (req, res) => {
  const parseResult = mealPlanRequestSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.flatten()
    });
  }

  const payload: MealPlanRequest = parseResult.data;

  try {
    const response = await openai.responses.parse({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify(payload)
        }
      ],
      text: {
        format: zodTextFormat(mealPlanResponseSchema, 'ChapterTwoMealPlan')
      }
    });

    const parsed = response.output_parsed as MealPlanResponse;

    // Optional: light sanity check that totals roughly align (non-blocking)
    // You can add warnings into `notes` later if you want.

    return res.json(parsed);
  } catch (error: any) {
    console.error('Error generating meal plan:', error?.response ?? error);

    return res.status(500).json({
      error: 'Failed to generate meal plan at this time.'
    });
  }
});
