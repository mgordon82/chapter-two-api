import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../config/db';
import { requireCognitoAuth } from '../middleware/requireCognitoAuth';
import { createSignedPhotoViewUrl } from '../utils/r2Uploads';
import { openai } from '../config/openai';

export const photoComparisonRouter = Router();

type PhotoPosition = 'front' | 'side' | 'back';

type PhotoComparisonAiResult = {
  summary: string;
  notableProgress: string[];
  likelySignals: string[];
  nextFocusAreas: string[];
  encouragement: string;
  confidenceNote: string;
};

type StoredPhotoComparisonAnalysis = PhotoComparisonAiResult & {
  model?: string;
  generatedAt?: Date | string | null;
  comparedPositions?: PhotoPosition[];
};

const photoComparisonSchema = {
  name: 'photo_comparison_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'notableProgress',
      'likelySignals',
      'nextFocusAreas',
      'encouragement',
      'confidenceNote'
    ],
    properties: {
      summary: {
        type: 'string'
      },
      notableProgress: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        items: { type: 'string' }
      },
      likelySignals: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: { type: 'string' }
      },
      nextFocusAreas: {
        type: 'array',
        minItems: 3,
        maxItems: 4,
        items: { type: 'string' }
      },
      encouragement: {
        type: 'string'
      },
      confidenceNote: {
        type: 'string'
      }
    }
  },
  strict: true
} as const;

async function fetchImageAsDataUrl(
  imageUrl: string,
  mimeType: string
): Promise<string> {
  const resp = await fetch(imageUrl);

  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');

  return `data:${mimeType};base64,${base64}`;
}

function toValidDate(value: unknown): Date | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

photoComparisonRouter.post('/analyze', requireCognitoAuth, async (req, res) => {
  const routeStart = Date.now();

  try {
    const sub = req.cognito?.sub;
    if (!sub) {
      return res.status(401).json({ message: 'Missing Cognito sub' });
    }

    const { checkInId } = req.body ?? {};

    if (
      typeof checkInId !== 'string' ||
      checkInId.trim().length === 0 ||
      !ObjectId.isValid(checkInId)
    ) {
      return res.status(400).json({
        message: 'checkInId must be a valid ObjectId string'
      });
    }

    const db = getDb();
    const users = db.collection('users');
    const photoSets = db.collection('photoSets');
    const checkIns = db.collection('checkIns');

    const actor = await users.findOne({ 'auth.cognitoSub': sub });
    if (!actor) {
      return res.status(401).json({ message: 'User not found for this token' });
    }

    const starterSet = await photoSets.findOne({
      userId: actor._id,
      type: 'starter',
      status: 'active',
      isDeleted: false
    });

    if (!starterSet) {
      return res.status(404).json({
        message: 'Starter photo set not found'
      });
    }

    const checkIn = await checkIns.findOne({
      _id: new ObjectId(checkInId),
      userId: actor._id,
      isDeleted: false
    });

    if (!checkIn) {
      return res.status(404).json({
        message: 'Check-in not found'
      });
    }

    if (!checkIn.hasPhotos || !Array.isArray(checkIn.photos?.photos)) {
      return res.status(409).json({
        message: 'Selected check-in does not have progress photos'
      });
    }

    const positions: PhotoPosition[] = ['front', 'side', 'back'];

    const matchedPairs = positions
      .map((position) => {
        const starter =
          starterSet.photos?.find(
            (photo: any) => photo.position === position
          ) ?? null;
        const progress =
          checkIn.photos.photos.find(
            (photo: any) => photo.position === position
          ) ?? null;

        if (!starter || !progress) return null;

        return {
          position,
          starter,
          progress
        };
      })
      .filter(Boolean) as Array<{
      position: PhotoPosition;
      starter: any;
      progress: any;
    }>;

    if (matchedPairs.length === 0) {
      return res.status(409).json({
        message:
          'No matching starter/progress photo pairs were found for this check-in'
      });
    }

    const starterFront =
      matchedPairs.find((pair) => pair.position === 'front')?.starter ?? null;
    const progressFront =
      matchedPairs.find((pair) => pair.position === 'front')?.progress ?? null;

    const primaryStarterPhoto = starterFront ?? matchedPairs[0].starter;

    const starterTakenAt = toValidDate(primaryStarterPhoto?.takenAt);
    const starterCreatedAt = toValidDate(starterSet.createdAt);
    const progressRecordedAt = toValidDate(checkIn.recordedAt);

    const comparisonStartDate = starterTakenAt ?? starterCreatedAt;
    const comparisonEndDate = progressRecordedAt;

    const daysBetween =
      comparisonStartDate && comparisonEndDate
        ? Math.max(
            0,
            Math.round(
              (comparisonEndDate.getTime() - comparisonStartDate.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          )
        : null;

    const existingAnalysis = checkIn.photoComparisonAnalysis as
      | StoredPhotoComparisonAnalysis
      | undefined;

    const signedPairs = await Promise.all(
      matchedPairs.map(async (pair) => {
        const [starterViewUrl, progressViewUrl] = await Promise.all([
          createSignedPhotoViewUrl({
            storageKey: pair.starter.storageKey,
            expiresInSeconds: 900
          }),
          createSignedPhotoViewUrl({
            storageKey: pair.progress.storageKey,
            expiresInSeconds: 900
          })
        ]);

        return {
          position: pair.position,
          starter: {
            position: pair.starter.position,
            storageKey: pair.starter.storageKey,
            mimeType: pair.starter.mimeType,
            viewUrl: starterViewUrl,
            takenAt:
              pair.starter.takenAt instanceof Date
                ? pair.starter.takenAt.toISOString()
                : pair.starter.takenAt ?? null
          },
          progress: {
            position: pair.progress.position,
            storageKey: pair.progress.storageKey,
            mimeType: pair.progress.mimeType,
            viewUrl: progressViewUrl
          }
        };
      })
    );

    if (existingAnalysis) {
      return res.json({
        ok: true,
        cached: true,
        checkIn: {
          id: checkIn._id.toString(),
          recordedAt:
            checkIn.recordedAt instanceof Date
              ? checkIn.recordedAt.toISOString()
              : checkIn.recordedAt
        },
        comparison: {
          pairs: signedPairs,
          comparedPositions:
            existingAnalysis.comparedPositions ??
            signedPairs.map((pair) => pair.position),
          daysBetween
        },
        analysis: {
          summary: existingAnalysis.summary,
          notableProgress: existingAnalysis.notableProgress ?? [],
          likelySignals: existingAnalysis.likelySignals ?? [],
          nextFocusAreas: existingAnalysis.nextFocusAreas ?? [],
          encouragement: existingAnalysis.encouragement,
          confidenceNote: existingAnalysis.confidenceNote,
          model: existingAnalysis.model ?? null,
          generatedAt:
            existingAnalysis.generatedAt instanceof Date
              ? existingAnalysis.generatedAt.toISOString()
              : existingAnalysis.generatedAt ?? null
        }
      });
    }

    const imagePrepStart = Date.now();

    const preparedPairs = await Promise.all(
      signedPairs.map(async (pair) => {
        const [starterDataUrl, progressDataUrl] = await Promise.all([
          fetchImageAsDataUrl(pair.starter.viewUrl, pair.starter.mimeType),
          fetchImageAsDataUrl(pair.progress.viewUrl, pair.progress.mimeType)
        ]);

        return {
          ...pair,
          starterDataUrl,
          progressDataUrl
        };
      })
    );

    const model = process.env.OPENAI_MODEL_MINI || 'gpt-5-mini';

    const aiStart = Date.now();

    const userContent: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'low' }
    > = [
      {
        type: 'input_text',
        text: [
          daysBetween != null
            ? `Compare these starter and progress photos taken approximately ${daysBetween} days apart.`
            : 'Compare these starter and progress photos.',
          `Use all available matching angles: ${preparedPairs
            .map((pair) => pair.position)
            .join(', ')}.`,
          'Each angle includes a starter image followed by a later progress image.',
          'Prioritize visible signs of progress and what they may suggest is working.',
          'Keep the feedback practical, encouraging, and grounded in what is visually observable.',
          'Only mention setup differences briefly if they meaningfully reduce confidence.',
          'Do not mention irrelevant visual details.'
        ].join(' ')
      }
    ];

    for (const pair of preparedPairs) {
      userContent.push({
        type: 'input_text',
        text: `Starter ${pair.position} photo`
      });
      userContent.push({
        type: 'input_image',
        image_url: pair.starterDataUrl,
        detail: 'low'
      });
      userContent.push({
        type: 'input_text',
        text: `Progress ${pair.position} photo`
      });
      userContent.push({
        type: 'input_image',
        image_url: pair.progressDataUrl,
        detail: 'low'
      });
    }

    const response = await openai.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You compare matched physique progress photos of the same person across one or more angles.',
                'For each available angle, the starter image is shown first and the later progress image is shown second.',
                'Your job is to give supportive, useful progress feedback for a fitness app.',
                'Use all available matching angles together when forming your conclusions.',
                'Focus first on visible physique changes such as midsection shape, waistline, abdominal definition, chest shape, shoulder width or definition, arm definition, glute/hip silhouette, back shape, posture, and overall body silhouette depending on the angle shown.',
                'Prioritize meaningful signs of progress over generic photo commentary.',
                'Mention pose, lighting, angle, clothing, or distance differences only briefly and only when they materially affect confidence.',
                'Do not waste response space on trivial scene details or non-essential comparisons.',
                'When discussing what may be working, use careful language such as "may suggest", "could indicate", or "is consistent with".',
                'Do not present training, nutrition, or lifestyle causes as certain facts unless they are visually obvious.',
                'Recommendations should be practical, moderate, and supportive, not overly detailed or overly prescriptive.',
                'Prefer 3 to 4 strong points over long lists.',
                'Do not guess weight, body fat percentage, muscle mass, or medical conditions.',
                'Do not diagnose, shame, sexualize, or insult the person.',
                'Be specific, grounded, encouraging, and concise.'
              ].join(' ')
            }
          ]
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: photoComparisonSchema.name,
          schema: photoComparisonSchema.schema,
          strict: photoComparisonSchema.strict
        }
      }
    });

    const outputText = response.output_text ?? '';

    if (!outputText) {
      console.error('[photoComparison/analyze] missing output_text', {
        checkInId,
        userId: actor._id.toString()
      });

      return res.status(502).json({
        message: 'AI analysis returned an empty response'
      });
    }

    let analysis: PhotoComparisonAiResult;

    try {
      analysis = JSON.parse(outputText) as PhotoComparisonAiResult;
    } catch (parseErr) {
      console.error('[photoComparison/analyze] failed to parse AI JSON', {
        checkInId,
        userId: actor._id.toString(),
        outputText,
        parseErr
      });

      return res.status(502).json({
        message: 'AI analysis returned an invalid response'
      });
    }

    const generatedAt = new Date();
    const comparedPositions = preparedPairs.map((pair) => pair.position);

    await checkIns.updateOne(
      {
        _id: new ObjectId(checkInId),
        userId: actor._id,
        isDeleted: false
      },
      {
        $set: {
          photoComparisonAnalysis: {
            summary: analysis.summary,
            notableProgress: analysis.notableProgress,
            likelySignals: analysis.likelySignals,
            nextFocusAreas: analysis.nextFocusAreas,
            encouragement: analysis.encouragement,
            confidenceNote: analysis.confidenceNote,
            model,
            generatedAt,
            comparedPositions
          },
          updatedAt: generatedAt
        }
      }
    );

    return res.json({
      ok: true,
      cached: false,
      checkIn: {
        id: checkIn._id.toString(),
        recordedAt:
          checkIn.recordedAt instanceof Date
            ? checkIn.recordedAt.toISOString()
            : checkIn.recordedAt
      },
      comparison: {
        pairs: signedPairs,
        comparedPositions,
        daysBetween
      },
      analysis: {
        ...analysis,
        model,
        generatedAt: generatedAt.toISOString()
      }
    });
  } catch (err) {
    console.error('[photoComparison/analyze] failed:', err);

    return res.status(500).json({
      message: 'Failed to analyze photo comparison'
    });
  }
});
