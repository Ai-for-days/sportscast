// ── Step 144 / 145 / 146: Admin API for weather market idea generation ──
//
// Generates draft pointspread ideas (Step 144), supports target-difference
// search (Step 145), and persists selected ideas into a saved-idea
// review queue (Step 146). **Never creates or publishes a wager**, never
// touches pricing / settlement / grading / wallet code paths.
//
// Step 146 added the saved-idea CRUD actions:
//
//   GET  ?action=bootstrap         (default) — seed list + limits + statuses
//   GET  ?action=list-saved-ideas  — paged list of saved ideas
//   GET  ?action=get-saved-idea    — single saved idea by id
//   POST action=generate           — Step 144/145 generator (unchanged)
//   POST action=save-idea          — persist a generated idea
//   POST action=update-saved-idea-status — saved | reviewed | rejected | used
//   POST action=update-saved-idea-note   — update operatorNote (≤1000 chars)
//   POST action=delete-saved-idea
//
// All actions are admin-gated. The route still has no wager-mutation
// surface and never returns secrets.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  generateWeatherMarketIdeas,
  METRIC_PAIR_OPTIONS,
  TARGET_DIFFERENCE_F_MAX,
  TOLERANCE_F_MAX,
  MAX_RESULTS_CAP,
  type MetricPairOption,
  type WeatherMarketIdea,
} from '../../../../lib/weather-market-idea-generator';
import {
  saveIdea,
  listSavedIdeas,
  getSavedIdea,
  updateSavedIdeaStatus,
  updateSavedIdeaNote,
  deleteSavedIdea,
  SAVED_IDEA_STATUSES,
  MAX_SAVED_IDEAS,
  OPERATOR_NOTE_MAX_LEN,
  type SavedIdeaStatus,
} from '../../../../lib/weather-market-idea-store';
import { FORECAST_QUALITY_SEED_CITIES } from '../../../../lib/forecast-quality-seed-cities';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  return Number.isFinite(t);
}

function isFiniteNumberInRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

function isValidStatus(s: unknown): s is SavedIdeaStatus {
  return typeof s === 'string' && (SAVED_IDEA_STATUSES as readonly string[]).includes(s);
}

/**
 * Loose runtime check that the caller handed us a payload that *looks*
 * like a generator-produced WeatherMarketIdea. We don't deep-verify
 * every field — a malformed save will simply round-trip back to the
 * UI looking malformed, which is acceptable for an admin-only tool.
 */
function looksLikeIdea(x: any): x is WeatherMarketIdea {
  return (
    !!x &&
    typeof x === 'object' &&
    x.kind === 'pointspread' &&
    typeof x.title === 'string' &&
    typeof x.targetDate === 'string' &&
    typeof x.suggestedSpread === 'number' &&
    typeof x.prefillQuery === 'string' &&
    !!x.locationA &&
    !!x.locationB &&
    typeof x.metricA === 'string' &&
    typeof x.metricB === 'string'
  );
}

// ── GET ─────────────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'bootstrap';

  if (action === 'bootstrap') {
    return jsonResponse({
      seedCities: FORECAST_QUALITY_SEED_CITIES,
      metricPairOptions: METRIC_PAIR_OPTIONS,
      savedIdeaStatuses: SAVED_IDEA_STATUSES,
      limits: {
        targetDifferenceFMax: TARGET_DIFFERENCE_F_MAX,
        toleranceFMax: TOLERANCE_F_MAX,
        maxResultsCap: MAX_RESULTS_CAP,
        savedIdeasCap: MAX_SAVED_IDEAS,
        operatorNoteMaxLen: OPERATOR_NOTE_MAX_LEN,
      },
    });
  }

  if (action === 'list-saved-ideas') {
    const statusParam = url.searchParams.get('status');
    let status: SavedIdeaStatus | undefined;
    if (statusParam) {
      if (!isValidStatus(statusParam)) {
        return jsonResponse(
          {
            error: 'invalid_status',
            message: `status must be one of ${SAVED_IDEA_STATUSES.join(', ')}`,
          },
          400,
        );
      }
      status = statusParam;
    }
    const limitParam = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(MAX_SAVED_IDEAS, Math.round(limitParam))
      : 100;
    try {
      const ideas = await listSavedIdeas({ status, limit });
      return jsonResponse({ savedIdeas: ideas });
    } catch (err: any) {
      return jsonResponse(
        { error: 'list_saved_ideas_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  if (action === 'get-saved-idea') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) return jsonResponse({ error: 'missing_id' }, 400);
    const saved = await getSavedIdea(id);
    if (!saved) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ savedIdea: saved });
  }

  return jsonResponse(
    {
      error: 'Unknown GET action',
      supported: ['bootstrap', 'list-saved-ideas', 'get-saved-idea'],
    },
    400,
  );
};

// ── POST ────────────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const action = body.action as string | undefined;

  if (action === 'generate') {
    return handleGenerate(body, session);
  }
  if (action === 'save-idea') {
    return handleSaveIdea(body, session);
  }
  if (action === 'update-saved-idea-status') {
    return handleUpdateStatus(body, session);
  }
  if (action === 'update-saved-idea-note') {
    return handleUpdateNote(body, session);
  }
  if (action === 'delete-saved-idea') {
    return handleDeleteSaved(body, session);
  }

  return jsonResponse(
    {
      error: 'Unknown or missing action',
      supported: [
        'generate',
        'save-idea',
        'update-saved-idea-status',
        'update-saved-idea-note',
        'delete-saved-idea',
      ],
    },
    400,
  );
};

// ── POST handlers ───────────────────────────────────────────────────────────

async function handleGenerate(body: any, session: string): Promise<Response> {
  // Step 145 input envelope (unchanged).
  let targetDate: string | undefined =
    typeof body.targetDate === 'string' ? body.targetDate : undefined;
  const dayOffset =
    typeof body.dayOffset === 'number' && Number.isFinite(body.dayOffset)
      ? Math.round(body.dayOffset)
      : undefined;
  if (!targetDate && dayOffset === undefined) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate (YYYY-MM-DD) or dayOffset is required' },
      400,
    );
  }
  if (targetDate && !isValidDate(targetDate)) {
    return jsonResponse(
      { error: 'invalid_target_date', message: 'targetDate must be YYYY-MM-DD' },
      400,
    );
  }
  if (dayOffset !== undefined && !isFiniteNumberInRange(dayOffset, 0, 14)) {
    return jsonResponse(
      { error: 'invalid_day_offset', message: 'dayOffset must be 0–14' },
      400,
    );
  }

  let targetDifferenceF: number | undefined;
  if (body.targetDifferenceF !== undefined && body.targetDifferenceF !== null) {
    if (!isFiniteNumberInRange(body.targetDifferenceF, 0, TARGET_DIFFERENCE_F_MAX)) {
      return jsonResponse(
        {
          error: 'invalid_target_difference',
          message: `targetDifferenceF must be a number between 0 and ${TARGET_DIFFERENCE_F_MAX}`,
        },
        400,
      );
    }
    targetDifferenceF = body.targetDifferenceF;
  }

  let toleranceF: number | undefined;
  if (body.toleranceF !== undefined && body.toleranceF !== null) {
    if (!isFiniteNumberInRange(body.toleranceF, 0, TOLERANCE_F_MAX)) {
      return jsonResponse(
        {
          error: 'invalid_tolerance',
          message: `toleranceF must be a number between 0 and ${TOLERANCE_F_MAX}`,
        },
        400,
      );
    }
    toleranceF = body.toleranceF;
  }

  let metricPair: MetricPairOption | undefined;
  if (body.metricPair !== undefined && body.metricPair !== null) {
    if (
      typeof body.metricPair !== 'string' ||
      !METRIC_PAIR_OPTIONS.includes(body.metricPair as MetricPairOption)
    ) {
      return jsonResponse(
        {
          error: 'invalid_metric_pair',
          message: `metricPair must be one of ${METRIC_PAIR_OPTIONS.join(', ')}`,
        },
        400,
      );
    }
    metricPair = body.metricPair;
  }

  const cityIds = Array.isArray(body.cityIds)
    ? body.cityIds.filter((s: any) => typeof s === 'string')
    : undefined;

  let maxIdeas: number | undefined;
  if (body.maxIdeas !== undefined && body.maxIdeas !== null) {
    if (!isFiniteNumberInRange(body.maxIdeas, 1, MAX_RESULTS_CAP)) {
      return jsonResponse(
        { error: 'invalid_max_ideas', message: `maxIdeas must be 1–${MAX_RESULTS_CAP}` },
        400,
      );
    }
    maxIdeas = Math.round(body.maxIdeas);
  }

  let maxResults: number | undefined;
  if (body.maxResults !== undefined && body.maxResults !== null) {
    if (!isFiniteNumberInRange(body.maxResults, 1, MAX_RESULTS_CAP)) {
      return jsonResponse(
        { error: 'invalid_max_results', message: `maxResults must be 1–${MAX_RESULTS_CAP}` },
        400,
      );
    }
    maxResults = Math.round(body.maxResults);
  }

  try {
    const result = await generateWeatherMarketIdeas({
      targetDate,
      dayOffset,
      cityIds,
      maxIdeas,
      maxResults,
      targetDifferenceF,
      toleranceF,
      metricPair,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_ideas_generated',
        targetType: 'weather_market_ideas',
        summary: `Generated ${result.ideas.length} draft idea(s) for ${result.targetDate} (metricPair=${result.resolved.metricPair}${
          targetDifferenceF !== undefined ? `, target=${targetDifferenceF}±${toleranceF ?? 3}°F` : ''
        }) across ${result.cityCount} city/cities.`,
        details: {
          targetDate: result.targetDate,
          dayOffset,
          targetDifferenceF,
          toleranceF,
          metricPair: result.resolved.metricPair,
          cityCount: result.cityCount,
          ideaCount: result.ideas.length,
          warnings: result.warnings,
        },
      });
    }
    return jsonResponse({ result });
  } catch (err: any) {
    return jsonResponse(
      { error: 'weather_market_ideas_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleSaveIdea(body: any, session: string): Promise<Response> {
  if (!looksLikeIdea(body.idea)) {
    return jsonResponse(
      { error: 'invalid_idea', message: 'idea payload missing required pointspread fields' },
      400,
    );
  }
  const operatorNote =
    typeof body.operatorNote === 'string' && body.operatorNote.trim().length > 0
      ? body.operatorNote.slice(0, OPERATOR_NOTE_MAX_LEN)
      : undefined;

  // Optional context echo from the search controls.
  const ctx: any = {};
  if (typeof body.searchContext === 'object' && body.searchContext) {
    if (typeof body.searchContext.targetDifferenceF === 'number') ctx.targetDifferenceF = body.searchContext.targetDifferenceF;
    if (typeof body.searchContext.toleranceF === 'number') ctx.toleranceF = body.searchContext.toleranceF;
    if (typeof body.searchContext.dayOffset === 'number') ctx.dayOffset = body.searchContext.dayOffset;
    if (
      typeof body.searchContext.metricPair === 'string' &&
      METRIC_PAIR_OPTIONS.includes(body.searchContext.metricPair as MetricPairOption)
    ) {
      ctx.metricPair = body.searchContext.metricPair;
    }
  }

  try {
    const result = await saveIdea({
      idea: body.idea as WeatherMarketIdea,
      operatorNote,
      searchContext: Object.keys(ctx).length > 0 ? ctx : undefined,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: result.isDuplicate
          ? 'weather_market_idea_save_duplicate'
          : 'weather_market_idea_saved',
        targetType: 'weather_market_idea',
        targetId: result.savedIdea.id,
        summary: result.isDuplicate
          ? `Duplicate save attempt for "${result.savedIdea.idea.title}" (existing id ${result.savedIdea.id}).`
          : `Saved idea "${result.savedIdea.idea.title}" (target ${result.savedIdea.idea.targetDate}).`,
        details: {
          fingerprint: result.savedIdea.fingerprint,
          warningFlags: result.savedIdea.warningFlags,
          status: result.savedIdea.status,
        },
      });
    }
    return jsonResponse(
      { savedIdea: result.savedIdea, isDuplicate: result.isDuplicate, existingId: result.existingId },
      result.isDuplicate ? 200 : 201,
    );
  } catch (err: any) {
    return jsonResponse(
      { error: 'save_idea_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleUpdateStatus(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  if (!isValidStatus(body.status)) {
    return jsonResponse(
      {
        error: 'invalid_status',
        message: `status must be one of ${SAVED_IDEA_STATUSES.join(', ')}`,
      },
      400,
    );
  }
  try {
    const updated = await updateSavedIdeaStatus(id, body.status);
    if (!updated) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_idea_status_changed',
        targetType: 'weather_market_idea',
        targetId: id,
        summary: `Saved idea ${id} marked ${body.status}.`,
        details: { status: body.status },
      });
    }
    return jsonResponse({ savedIdea: updated });
  } catch (err: any) {
    return jsonResponse(
      { error: 'update_status_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleUpdateNote(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  const note = typeof body.note === 'string' ? body.note : '';
  try {
    const updated = await updateSavedIdeaNote(id, note);
    if (!updated) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_idea_note_updated',
        targetType: 'weather_market_idea',
        targetId: id,
        summary: `Saved idea ${id} note updated (${note.length} chars).`,
      });
    }
    return jsonResponse({ savedIdea: updated });
  } catch (err: any) {
    return jsonResponse(
      { error: 'update_note_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleDeleteSaved(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  try {
    const ok = await deleteSavedIdea(id);
    if (!ok) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_idea_deleted',
        targetType: 'weather_market_idea',
        targetId: id,
        summary: `Saved idea ${id} deleted.`,
      });
    }
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse(
      { error: 'delete_saved_idea_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}
