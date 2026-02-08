export interface PlanAuditMetadata {
  planLength: number;
  receivedAt: string;
  unfairnessScore?: number;
  model?: string;
}

export function scrubPlanText(raw: string): string {
  let scrubbed = raw;

  scrubbed = scrubbed.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    '[EMAIL]'
  );

  scrubbed = scrubbed.replace(
    /\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    '[PHONE]'
  );

  return scrubbed;
}

const PRIVACY_MODE = process.env.FH_PRIVACY_MODE || 'strict';

export function logPlanAudit(meta: PlanAuditMetadata) {
  if (PRIVACY_MODE === 'strict') {
    return;
  }

  const { planLength, receivedAt, unfairnessScore, model } = meta;

  console.log(
    '[Chapter Two Audit]',
    JSON.stringify(
      {
        planLength,
        receivedAt,
        unfairnessScore,
        model
      },
      null,
      2
    )
  );
}
