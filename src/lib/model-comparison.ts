import { getModelVersion, type ModelVersion } from './model-registry';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ComparisonResult {
  family: string;
  baselineId: string;
  candidateId: string;
  baseline: ModelVersion | null;
  candidate: ModelVersion | null;
  metadataDiff: { field: string; baseline: any; candidate: any }[];
  parameterDiff: { field: string; baseline: any; candidate: any }[];
  summary: string;
}

/* ------------------------------------------------------------------ */
/*  Compare two model versions                                         */
/* ------------------------------------------------------------------ */

export async function compareModels(
  baselineId: string,
  candidateId: string,
): Promise<ComparisonResult> {
  const baseline = await getModelVersion(baselineId);
  const candidate = await getModelVersion(candidateId);

  const metadataDiff: { field: string; baseline: any; candidate: any }[] = [];
  const parameterDiff: { field: string; baseline: any; candidate: any }[] = [];

  if (baseline && candidate) {
    // Metadata comparison
    const metaFields: (keyof ModelVersion)[] = ['version', 'name', 'description', 'status', 'createdAt'];
    for (const field of metaFields) {
      if (baseline[field] !== candidate[field]) {
        metadataDiff.push({ field, baseline: baseline[field], candidate: candidate[field] });
      }
    }

    // Parameter comparison
    const baseParams = baseline.parameters || {};
    const candParams = candidate.parameters || {};
    const allKeys = new Set([...Object.keys(baseParams), ...Object.keys(candParams)]);
    for (const key of allKeys) {
      const bv = baseParams[key];
      const cv = candParams[key];
      if (JSON.stringify(bv) !== JSON.stringify(cv)) {
        parameterDiff.push({ field: key, baseline: bv, candidate: cv });
      }
    }
  }

  const family = baseline?.family || candidate?.family || 'unknown';
  const summary = baseline && candidate
    ? `Comparing ${family}: ${baseline.version} (${baseline.name}) vs ${candidate.version} (${candidate.name}) — ${metadataDiff.length} metadata diffs, ${parameterDiff.length} parameter diffs`
    : 'One or both versions not found';

  return {
    family,
    baselineId,
    candidateId,
    baseline,
    candidate,
    metadataDiff,
    parameterDiff,
    summary,
  };
}
