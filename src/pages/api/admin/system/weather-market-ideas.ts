// ── Step 144 / 145 / 146 / 147: Admin API for weather market idea workflow ──
//
// Generates draft pointspread ideas (Step 144), supports target-difference
// search (Step 145), persists selected ideas into a saved-idea review
// queue (Step 146), and (Step 147) converts saved ideas into admin-only
// **draft wagers** that live in their own Redis namespace, completely
// isolated from the customer-facing wager store. **Never publishes a
// wager**, never touches pricing / settlement / grading / wallet code
// paths. Drafts are not visible on `/api/wagers` or `/api/wagers/[id]`.
//
// Action surface:
//
//   GET  ?action=bootstrap          (default) — seed list + limits + statuses
//   GET  ?action=list-saved-ideas   — paged list of saved ideas
//   GET  ?action=get-saved-idea     — single saved idea by id
//   GET  ?action=list-draft-wagers  — list draft wagers (Step 147)
//   GET  ?action=get-draft-wager    — single draft by id (Step 147)
//   POST action=generate            — Step 144/145 generator (unchanged)
//   POST action=save-idea           — persist a generated idea
//   POST action=update-saved-idea-status — saved | reviewed | rejected | used
//   POST action=update-saved-idea-note   — update operatorNote (≤1000 chars)
//   POST action=delete-saved-idea
//   POST action=create-draft-wager-from-idea — Step 147; refuses rejected
//                                              + already-drafted ideas;
//                                              marks source idea 'used'
//   POST action=delete-draft-wager
//
// All actions are admin-gated. The route still has no live-wager
// mutation surface and never returns secrets.

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
import {
  createDraftWager,
  listDraftWagers,
  getDraftWager,
  deleteDraftWager,
  findDraftBySavedIdeaId,
  markDraftPublished,
  MAX_DRAFTS,
  DRAFT_OPERATOR_NOTE_MAX_LEN,
} from '../../../../lib/weather-market-draft-wager-store';
import { buildDraftWagerInputFromIdea } from '../../../../lib/weather-market-idea-to-draft';
import { validateCreateWager } from '../../../../lib/wager-validation';
// Step 148 — the *only* call site of `createWager` from this admin
// route is the publish-draft-wager handler. Every other action in
// this file remains read-only with respect to the live wager store.
import { createWager } from '../../../../lib/wager-store';
import {
  createMarketQA,
  listMarketQA,
  getMarketQA,
  getMarketQAByWagerId,
  updateMarketQAChecklist,
  updateMarketQAStatus,
  sanitizeChecklist,
  MARKET_QA_STATUSES,
  MAX_QA_RECORDS,
  QA_OPERATOR_NOTE_MAX_LEN,
  type MarketQAStatus,
} from '../../../../lib/weather-market-qa-store';
import {
  fetchRiskUniverse,
  analyzeRisk,
  normalizeBareIdea,
  normalizeIdea,
  normalizeDraft,
  normalizeWager,
  RISK_WARNING_TYPES,
  type WeatherMarketRiskWarning,
  type MarketRiskUniverse,
} from '../../../../lib/weather-market-risk-warnings';
// Read-only access for risk analysis. The shim exposes ONLY the read
// helpers — `createWager` (the sole live-mutation we use, see Step 148)
// is still imported directly above so the trust footprint stays
// trivially greppable: any new mutation would have to add a new
// direct `wager-store` import.
import { getWager } from '../../../../lib/weather-market-store-admin';
import { FORECAST_QUALITY_SEED_CITIES } from '../../../../lib/forecast-quality-seed-cities';
import {
  CITY_UNIVERSE_MODES,
  CITY_REGION_FILTERS,
  EXPANDED_US_CITY_COUNT,
  MAX_EXPANDED_CITIES,
  DEFAULT_EXPANDED_MAX,
  resolveCityUniverse,
  listExpandedUniverse,
  validateExpandedCityIds,
  type CityUniverseMode,
  type CityRegionFilter,
} from '../../../../lib/weather-market-city-universe';
import {
  createCitySet,
  listCitySets,
  getCitySet,
  updateCitySet,
  deleteCitySet,
  MAX_CITY_SETS,
  CITY_SET_NAME_MAX_LEN,
  CITY_SET_NOTE_MAX_LEN,
  MAX_CITY_IDS_PER_SET,
  MAX_CITY_SET_TAGS,
} from '../../../../lib/weather-market-city-set-store';

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

// Step 151 — narrow type for the soft-confirmation override metadata
// the client sends when an operator chose to proceed past a high-
// severity warning. Persisted only inside the existing audit event
// `details` payload — no new store, no new public surface.
interface RiskOverridePayload {
  confirmed: true;
  types: string[];
  count: number;
}

function parseRiskOverride(raw: unknown): RiskOverridePayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { confirmed?: unknown; types?: unknown; count?: unknown };
  if (r.confirmed !== true) return undefined;
  const types = Array.isArray(r.types)
    ? r.types.filter((t): t is string => typeof t === 'string').slice(0, 16)
    : [];
  const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.round(r.count) : 0;
  return { confirmed: true, types, count };
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
    // Step 152 — surface a per-region count so the UI can label the
    // region selector ("Texas (9)" etc.) without re-deriving on the
    // client. Single resolve per region is cheap (static array slice).
    const expandedRegionCounts: Record<CityRegionFilter, number> = Object.fromEntries(
      CITY_REGION_FILTERS.map((r) => [
        r,
        resolveCityUniverse({ mode: 'expanded_us', region: r }).cities.length,
      ]),
    ) as Record<CityRegionFilter, number>;
    return jsonResponse({
      seedCities: FORECAST_QUALITY_SEED_CITIES,
      metricPairOptions: METRIC_PAIR_OPTIONS,
      savedIdeaStatuses: SAVED_IDEA_STATUSES,
      qaStatuses: MARKET_QA_STATUSES,
      riskWarningTypes: RISK_WARNING_TYPES,
      // Step 152 — bounded universe metadata so the UI can render the
      // controls + per-region counts without hardcoding values.
      cityUniverseOptions: CITY_UNIVERSE_MODES,
      regionOptions: CITY_REGION_FILTERS,
      expandedUsCityCount: EXPANDED_US_CITY_COUNT,
      expandedRegionCounts,
      // Step 153 — full curated city catalog so the searchable picker
      // doesn't have to round-trip per query. Admin-only surface; safe
      // to include lat/lon. (No public/customer route reads this.)
      expandedCities: listExpandedUniverse(),
      limits: {
        targetDifferenceFMax: TARGET_DIFFERENCE_F_MAX,
        toleranceFMax: TOLERANCE_F_MAX,
        maxResultsCap: MAX_RESULTS_CAP,
        savedIdeasCap: MAX_SAVED_IDEAS,
        operatorNoteMaxLen: OPERATOR_NOTE_MAX_LEN,
        draftWagersCap: MAX_DRAFTS,
        draftOperatorNoteMaxLen: DRAFT_OPERATOR_NOTE_MAX_LEN,
        qaRecordsCap: MAX_QA_RECORDS,
        qaOperatorNoteMaxLen: QA_OPERATOR_NOTE_MAX_LEN,
        maxCandidateCitiesCap: MAX_EXPANDED_CITIES,
        defaultExpandedCandidateCities: DEFAULT_EXPANDED_MAX,
        // Step 153 — favorite city sets.
        citySetsCap: MAX_CITY_SETS,
        citySetNameMaxLen: CITY_SET_NAME_MAX_LEN,
        citySetNoteMaxLen: CITY_SET_NOTE_MAX_LEN,
        maxCityIdsPerSet: MAX_CITY_IDS_PER_SET,
        maxCitySetTags: MAX_CITY_SET_TAGS,
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
      // Step 150 — attach advisory risk warnings per record. Universe
      // fetched once for the whole list. Failures here are non-fatal:
      // we still return the ideas without warnings rather than 500.
      const warningsBySavedId: Record<string, WeatherMarketRiskWarning[]> = {};
      try {
        const universe = await fetchRiskUniverse();
        for (const s of ideas) {
          const candidate = normalizeIdea(s);
          warningsBySavedId[s.id] = analyzeRisk(candidate, universe);
        }
      } catch {
        /* fall through with empty warnings */
      }
      return jsonResponse({ savedIdeas: ideas, riskWarnings: warningsBySavedId });
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

  if (action === 'list-draft-wagers') {
    const limitParam = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(MAX_DRAFTS, Math.round(limitParam))
      : MAX_DRAFTS;
    try {
      const drafts = await listDraftWagers(limit);
      const warningsByDraftId: Record<string, WeatherMarketRiskWarning[]> = {};
      try {
        const universe = await fetchRiskUniverse();
        for (const d of drafts) {
          const candidate = normalizeDraft(d);
          warningsByDraftId[d.id] = analyzeRisk(candidate, universe);
        }
      } catch {
        /* non-fatal */
      }
      return jsonResponse({ draftWagers: drafts, riskWarnings: warningsByDraftId });
    } catch (err: any) {
      return jsonResponse(
        { error: 'list_draft_wagers_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  if (action === 'get-draft-wager') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) return jsonResponse({ error: 'missing_id' }, 400);
    const draft = await getDraftWager(id);
    if (!draft) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ draftWager: draft });
  }

  if (action === 'list-market-qa') {
    const statusParam = url.searchParams.get('status');
    let status: MarketQAStatus | undefined;
    if (statusParam) {
      if (!(MARKET_QA_STATUSES as readonly string[]).includes(statusParam)) {
        return jsonResponse(
          {
            error: 'invalid_qa_status',
            message: `status must be one of ${MARKET_QA_STATUSES.join(', ')}`,
          },
          400,
        );
      }
      status = statusParam as MarketQAStatus;
    }
    const limitParam = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(MAX_QA_RECORDS, Math.round(limitParam))
      : 100;
    try {
      const qaRecords = await listMarketQA({ status, limit });
      // Step 150 — surface risk warnings on QA records too. We fetch
      // each QA's underlying live wager so the analyzer sees the real
      // post-publish shape. Per-wager fetch failures are isolated.
      const warningsByQAId: Record<string, WeatherMarketRiskWarning[]> = {};
      try {
        const universe = await fetchRiskUniverse();
        for (const qa of qaRecords) {
          try {
            const wager = await getWager(qa.wagerId);
            const candidate = wager ? normalizeWager(wager) : null;
            if (candidate) {
              warningsByQAId[qa.id] = analyzeRisk(candidate, universe);
            }
          } catch {
            /* per-record */
          }
        }
      } catch {
        /* non-fatal */
      }
      return jsonResponse({ qaRecords, riskWarnings: warningsByQAId });
    } catch (err: any) {
      return jsonResponse(
        { error: 'list_market_qa_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  if (action === 'get-market-qa') {
    const id = url.searchParams.get('id') ?? '';
    const wagerId = url.searchParams.get('wagerId') ?? '';
    if (!id && !wagerId) return jsonResponse({ error: 'missing_id_or_wagerId' }, 400);
    const qa = id
      ? await getMarketQA(id)
      : await getMarketQAByWagerId(wagerId);
    if (!qa) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ qa });
  }

  if (action === 'list-city-sets') {
    try {
      const citySets = await listCitySets();
      return jsonResponse({ citySets });
    } catch (err: any) {
      return jsonResponse(
        { error: 'list_city_sets_failed', message: err?.message ?? String(err) },
        500,
      );
    }
  }

  if (action === 'get-city-set') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) return jsonResponse({ error: 'missing_id' }, 400);
    const set = await getCitySet(id);
    if (!set) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ citySet: set });
  }

  return jsonResponse(
    {
      error: 'Unknown GET action',
      supported: [
        'bootstrap',
        'list-saved-ideas',
        'get-saved-idea',
        'list-draft-wagers',
        'get-draft-wager',
        'list-market-qa',
        'get-market-qa',
        'list-city-sets',
        'get-city-set',
      ],
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
  if (action === 'create-draft-wager-from-idea') {
    return handleCreateDraftFromIdea(body, session);
  }
  if (action === 'delete-draft-wager') {
    return handleDeleteDraft(body, session);
  }
  if (action === 'publish-draft-wager') {
    return handlePublishDraft(body, session);
  }
  if (action === 'update-market-qa') {
    return handleUpdateQAChecklist(body, session);
  }
  if (action === 'update-market-qa-status') {
    return handleUpdateQAStatus(body, session);
  }
  if (action === 'analyze-risk-for-idea') {
    return handleAnalyzeRiskForIdea(body);
  }
  if (action === 'analyze-risk-for-draft') {
    return handleAnalyzeRiskForDraft(body);
  }
  if (action === 'analyze-risk-for-wager') {
    return handleAnalyzeRiskForWager(body);
  }
  if (action === 'create-city-set') {
    return handleCreateCitySet(body, session);
  }
  if (action === 'update-city-set') {
    return handleUpdateCitySet(body, session);
  }
  if (action === 'delete-city-set') {
    return handleDeleteCitySet(body, session);
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
        'create-draft-wager-from-idea',
        'delete-draft-wager',
        'publish-draft-wager',
        'update-market-qa',
        'update-market-qa-status',
        'analyze-risk-for-idea',
        'analyze-risk-for-draft',
        'analyze-risk-for-wager',
        'create-city-set',
        'update-city-set',
        'delete-city-set',
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

  // Step 153 — when the operator targets specific city ids, validate
  // them against the static expanded universe BEFORE the generator
  // touches anything. This rejects typos / hostile input cleanly with
  // a 400 instead of silently filtering, and guarantees that a future
  // change to the resolver can never expand the trust surface beyond
  // the curated catalog. Hard cap at MAX_EXPANDED_CITIES (= 100).
  if (cityIds && cityIds.length > 0) {
    if (cityIds.length > MAX_EXPANDED_CITIES) {
      return jsonResponse(
        {
          error: 'too_many_city_ids',
          message: `cityIds must contain at most ${MAX_EXPANDED_CITIES} entries.`,
          suppliedCount: cityIds.length,
        },
        400,
      );
    }
    const { invalid } = validateExpandedCityIds(cityIds);
    if (invalid.length > 0) {
      return jsonResponse(
        {
          error: 'invalid_city_ids',
          message: 'One or more cityIds are not in the curated city universe.',
          invalidCityIds: invalid.slice(0, 10),
          totalInvalid: invalid.length,
        },
        400,
      );
    }
  }

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

  // Step 152 — validate the bounded city-universe selectors. All three
  // are allow-listed: enums for cityUniverse and region; numeric range
  // for maxCandidateCities (clamped to MAX_EXPANDED_CITIES). Anything
  // outside the allow-list is rejected before the generator runs.
  let cityUniverse: CityUniverseMode | undefined;
  if (body.cityUniverse !== undefined && body.cityUniverse !== null) {
    if (
      typeof body.cityUniverse !== 'string' ||
      !(CITY_UNIVERSE_MODES as readonly string[]).includes(body.cityUniverse)
    ) {
      return jsonResponse(
        {
          error: 'invalid_city_universe',
          message: `cityUniverse must be one of ${CITY_UNIVERSE_MODES.join(', ')}`,
        },
        400,
      );
    }
    cityUniverse = body.cityUniverse as CityUniverseMode;
  }

  let region: CityRegionFilter | undefined;
  if (body.region !== undefined && body.region !== null) {
    if (
      typeof body.region !== 'string' ||
      !(CITY_REGION_FILTERS as readonly string[]).includes(body.region)
    ) {
      return jsonResponse(
        {
          error: 'invalid_region',
          message: `region must be one of ${CITY_REGION_FILTERS.join(', ')}`,
        },
        400,
      );
    }
    region = body.region as CityRegionFilter;
  }

  let maxCandidateCities: number | undefined;
  if (body.maxCandidateCities !== undefined && body.maxCandidateCities !== null) {
    if (!isFiniteNumberInRange(body.maxCandidateCities, 1, MAX_EXPANDED_CITIES)) {
      return jsonResponse(
        {
          error: 'invalid_max_candidate_cities',
          message: `maxCandidateCities must be 1–${MAX_EXPANDED_CITIES}`,
        },
        400,
      );
    }
    maxCandidateCities = Math.round(body.maxCandidateCities);
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
      cityUniverse,
      region,
      maxCandidateCities,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_ideas_generated',
        targetType: 'weather_market_ideas',
        summary: `Generated ${result.ideas.length} draft idea(s) for ${result.targetDate} (metricPair=${result.resolved.metricPair}, universe=${result.resolved.cityUniverse}, region=${result.resolved.region}${
          targetDifferenceF !== undefined ? `, target=${targetDifferenceF}±${toleranceF ?? 3}°F` : ''
        }) across ${result.resolved.successfulForecastCount}/${result.resolved.candidateCityCount} city/cities${result.resolved.failedForecastCount > 0 ? ` (${result.resolved.failedForecastCount} forecast fetch failure(s))` : ''}.`,
        details: {
          targetDate: result.targetDate,
          dayOffset,
          targetDifferenceF,
          toleranceF,
          metricPair: result.resolved.metricPair,
          cityUniverse: result.resolved.cityUniverse,
          region: result.resolved.region,
          candidateCityCount: result.resolved.candidateCityCount,
          successfulForecastCount: result.resolved.successfulForecastCount,
          failedForecastCount: result.resolved.failedForecastCount,
          cityCountCappedTo: result.resolved.cityCountCappedTo,
          ideaCount: result.ideas.length,
          warnings: result.warnings,
        },
      });
    }
    // Step 150 — attach risk warnings to each generated idea so the
    // operator sees correlation/duplication before saving. Universe
    // fetched once for the batch. Failures here are non-fatal.
    let warningsByIdeaId: Record<string, WeatherMarketRiskWarning[]> = {};
    try {
      if (result.ideas.length > 0) {
        const universe = await fetchRiskUniverse();
        for (const idea of result.ideas) {
          warningsByIdeaId[idea.id] = analyzeRisk(normalizeBareIdea(idea), universe);
        }
      }
    } catch {
      warningsByIdeaId = {};
    }
    return jsonResponse({ result, riskWarnings: warningsByIdeaId });
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

  // Step 151 — pick up soft-confirmation override metadata if the
  // operator clicked "Continue anyway" past a high-severity warning.
  const riskOverride = parseRiskOverride(body.riskOverride);

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
          : `Saved idea "${result.savedIdea.idea.title}" (target ${result.savedIdea.idea.targetDate})${riskOverride ? ` [risk override: ${riskOverride.count} high-severity warning(s) acknowledged]` : ''}.`,
        details: {
          fingerprint: result.savedIdea.fingerprint,
          warningFlags: result.savedIdea.warningFlags,
          status: result.savedIdea.status,
          ...(riskOverride ? { riskOverride } : {}),
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

// ── Step 147 — saved idea → admin draft wager ──────────────────────────────

async function handleCreateDraftFromIdea(body: any, session: string): Promise<Response> {
  const savedIdeaId = typeof body.savedIdeaId === 'string' ? body.savedIdeaId : '';
  if (!savedIdeaId) return jsonResponse({ error: 'missing_saved_idea_id' }, 400);

  const saved = await getSavedIdea(savedIdeaId);
  if (!saved) return jsonResponse({ error: 'not_found' }, 404);
  if (saved.status === 'rejected') {
    return jsonResponse(
      {
        error: 'idea_rejected',
        message:
          'This saved idea is marked rejected. Restore its status before creating a draft wager.',
      },
      409,
    );
  }

  // Duplicate-draft guard: refuse if a draft already exists for this
  // saved idea. Operator must delete the existing draft first.
  const existingDraft = await findDraftBySavedIdeaId(savedIdeaId);
  if (existingDraft) {
    return jsonResponse(
      {
        error: 'draft_already_exists',
        message: `A draft wager (${existingDraft.id}) already exists for this saved idea. Delete it first if you want to recreate.`,
        existingDraftId: existingDraft.id,
      },
      409,
    );
  }

  const titleOverride = typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title.trim().slice(0, 200)
    : undefined;
  const descriptionOverride = typeof body.description === 'string'
    ? body.description.trim()
    : undefined;
  const operatorNote =
    typeof body.operatorNote === 'string' && body.operatorNote.trim().length > 0
      ? body.operatorNote.slice(0, DRAFT_OPERATOR_NOTE_MAX_LEN)
      : undefined;

  const riskOverride = parseRiskOverride(body.riskOverride);

  const { input, rulesCopy, warnings } = buildDraftWagerInputFromIdea(saved.idea, {
    title: titleOverride,
    description: descriptionOverride,
  });

  try {
    const draft = await createDraftWager({
      input,
      summary: {
        title: input.title,
        description: input.description,
        kind: input.kind,
        metric: input.metric,
        metricA: input.metricA,
        metricB: input.metricB,
        targetDate: input.targetDate,
        locationAName: input.locationA?.name,
        locationBName: input.locationB?.name,
        spread: input.spread,
        locationAOdds: input.locationAOdds,
        locationBOdds: input.locationBOdds,
        rulesCopy,
        warnings,
      },
      provenance: {
        savedIdeaId: saved.id,
        ideaId: saved.idea.id,
        ideaFingerprint: saved.fingerprint,
      },
      operatorNote,
    });

    // Mark the source saved idea as 'used' once the draft persists. We
    // do this AFTER the draft write so a Redis failure on the draft
    // never advances the saved-idea status.
    let updatedSavedIdea = saved;
    try {
      const result = await updateSavedIdeaStatus(saved.id, 'used');
      if (result) updatedSavedIdea = result;
    } catch {
      // Non-fatal — the draft exists; the operator can mark the idea
      // 'used' from the saved-ideas tab if this transient call failed.
    }

    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_draft_wager_created',
        targetType: 'weather_market_draft_wager',
        targetId: draft.id,
        summary: `Draft wager ${draft.id} created from saved idea ${saved.id} ("${input.title}")${riskOverride ? ` [risk override: ${riskOverride.count} high-severity warning(s) acknowledged]` : ''}.`,
        details: {
          savedIdeaId: saved.id,
          ideaFingerprint: saved.fingerprint,
          targetDate: input.targetDate,
          warnings,
          ...(riskOverride ? { riskOverride } : {}),
        },
      });
    }

    return jsonResponse({ draftWager: draft, savedIdea: updatedSavedIdea }, 201);
  } catch (err: any) {
    return jsonResponse(
      { error: 'create_draft_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleDeleteDraft(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  try {
    const ok = await deleteDraftWager(id);
    if (!ok) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_draft_wager_deleted',
        targetType: 'weather_market_draft_wager',
        targetId: id,
        summary: `Draft wager ${id} deleted.`,
      });
    }
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse(
      { error: 'delete_draft_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

// ── Step 148 — publish an admin draft into the live wager store ────────────
//
// This is the **only** action in this file that calls `createWager`
// from `wager-store`. It runs the draft's frozen `CreateWagerInput`
// through the same `validateCreateWager` the existing
// `/api/admin/wagers` POST uses, and on success flips the draft to
// `status='published'` (the draft record is kept so the audit trail
// across save → draft → publish is preserved and a duplicate-publish
// guard has trivial state to check).
//
// Failure semantics:
//   - draft missing (or id missing)        → 404 / 400, no createWager call
//   - draft already published              → 409, returns existing wager id
//   - validateCreateWager rejects          → 400 with errors, no createWager call
//   - createWager throws                   → 500, draft untouched
//   - createWager succeeds, mark fails     → 200 with `warning` + the live wager id
//                                            so the operator can manually mark it
//                                            (the live wager already exists; we do
//                                             not try to roll it back)
//   - audit-log write fails                → ignored (matches Step 146/147 policy)

async function handlePublishDraft(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);

  const draft = await getDraftWager(id);
  if (!draft) return jsonResponse({ error: 'not_found' }, 404);

  // Duplicate-publish guard — refuse if the draft already has a live id.
  if (draft.status === 'published' && draft.publishedWagerId) {
    return jsonResponse(
      {
        error: 'draft_already_published',
        message: `Draft ${id} was already published as wager ${draft.publishedWagerId}.`,
        publishedWagerId: draft.publishedWagerId,
        publishedAt: draft.publishedAt,
      },
      409,
    );
  }

  // Run the existing validator. Anything that wouldn't pass the
  // /api/admin/wagers POST path won't pass here either.
  const validation = validateCreateWager(draft.input);
  if (!validation.valid) {
    return jsonResponse(
      {
        error: 'invalid_draft_input',
        message: 'Draft input did not pass wager validation. Delete the draft and recreate from the saved idea.',
        errors: validation.errors,
      },
      400,
    );
  }

  const riskOverride = parseRiskOverride(body.riskOverride);

  // Live createWager — only call site of this function from this file.
  let createdWager: Awaited<ReturnType<typeof createWager>> | null = null;
  try {
    createdWager = await createWager(draft.input);
  } catch (err: any) {
    return jsonResponse(
      { error: 'create_wager_failed', message: err?.message ?? String(err) },
      500,
    );
  }

  // Best-effort: mark the draft published so the duplicate-publish
  // guard catches the next click. If this write fails, we still return
  // success with a `warning` carrying the live wager id — the operator
  // can manually clean up the draft from the Drafts tab.
  let updatedDraft = draft;
  const warnings: string[] = [];
  try {
    const m = await markDraftPublished(draft.id, createdWager.id);
    if (m) updatedDraft = m;
    else warnings.push('Draft record went missing between publish and mark — the live wager exists but the draft tracking was not updated.');
  } catch (err: any) {
    warnings.push(`Draft tracking update failed (${err?.message ?? String(err)}). The live wager was created. Manually delete the draft from the Drafts tab.`);
  }

  // Step 149 — auto-create the post-publish QA checklist record so the
  // operator finds it pre-populated on the QA tab. Failure here is
  // **non-fatal** (per spec: "if QA creation fails after wager publish,
  // do NOT roll back wager"). We surface a warning instead and the
  // operator can manually create or recreate the QA record from the
  // QA tab if desired.
  let qaRecord: Awaited<ReturnType<typeof createMarketQA>> | null = null;
  try {
    qaRecord = await createMarketQA({
      wagerId: createdWager.id,
      sourceDraftId: draft.id,
      sourceIdeaId: draft.provenance.savedIdeaId,
      snapshot: {
        title: draft.input.title,
        targetDate: draft.input.targetDate,
        metric: draft.input.metric,
        metricA: draft.input.metricA,
        metricB: draft.input.metricB,
        locationAName: draft.input.locationA?.name,
        locationBName: draft.input.locationB?.name,
        spread: draft.input.spread,
        locationAOdds: draft.input.locationAOdds,
        locationBOdds: draft.input.locationBOdds,
      },
    });
  } catch (err: any) {
    warnings.push(`QA checklist record could not be created (${err?.message ?? String(err)}). The live wager was published. Operators can still review the wager — they just need to create a QA record manually from the QA tab.`);
  }

  // Audit log — success path. Failures here are non-fatal (matches the
  // Step 146/147 policy: the existing /api/admin/wagers POST also
  // creates wagers without an audit-log write of its own, so we'd
  // already be at parity even on a missing audit event).
  const actor = await getOperatorId(session ?? '');
  if (actor) {
    try {
      await logAuditEvent({
        actor,
        eventType: 'weather_market_draft_wager_published',
        targetType: 'weather_market_draft_wager',
        targetId: draft.id,
        summary: `Draft wager ${draft.id} published as live wager ${createdWager.id} ("${draft.input.title}")${riskOverride ? ` [risk override: ${riskOverride.count} high-severity warning(s) acknowledged]` : ''}.`,
        details: {
          draftId: draft.id,
          publishedWagerId: createdWager.id,
          savedIdeaId: draft.provenance.savedIdeaId,
          ideaFingerprint: draft.provenance.ideaFingerprint,
          targetDate: draft.input.targetDate,
          qaId: qaRecord?.id,
          warnings,
          ...(riskOverride ? { riskOverride } : {}),
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return jsonResponse(
    {
      draftWager: updatedDraft,
      wager: createdWager,
      qa: qaRecord,
      warning: warnings.length === 0 ? undefined : warnings.join(' · '),
      warnings,
    },
    201,
  );
}

// ── Step 149 — QA checklist actions ─────────────────────────────────────────

async function handleUpdateQAChecklist(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  const checklist = sanitizeChecklist(body.checklist);
  const operatorNote = typeof body.operatorNote === 'string'
    ? body.operatorNote.slice(0, QA_OPERATOR_NOTE_MAX_LEN)
    : undefined;
  try {
    const actor = await getOperatorId(session ?? '');
    const updated = await updateMarketQAChecklist({
      id,
      checklist,
      operatorNote,
      reviewedBy: actor ?? undefined,
    });
    if (!updated) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ qa: updated });
  } catch (err: any) {
    return jsonResponse(
      { error: 'update_qa_checklist_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

// ── Step 150 — risk-warning analyze actions ────────────────────────────────
//
// All three are read-only: they fetch the comparison universe and run
// the pure analyzer. They never mutate the wager / draft / saved-idea
// / QA stores. Per spec these are advisory only — no action here ever
// blocks a button or cancels a market.

async function handleAnalyzeRiskForIdea(body: any): Promise<Response> {
  // Two input modes:
  //   - `savedIdeaId`: look up a saved idea and analyze its `.idea` snapshot
  //   - `idea`: caller supplies the bare WeatherMarketIdea (e.g. from a
  //              fresh generate response, before saving)
  let candidate;
  if (typeof body.savedIdeaId === 'string' && body.savedIdeaId) {
    const saved = await getSavedIdea(body.savedIdeaId);
    if (!saved) return jsonResponse({ error: 'not_found' }, 404);
    candidate = normalizeIdea(saved);
  } else if (body.idea && typeof body.idea === 'object' && body.idea.kind === 'pointspread') {
    candidate = normalizeBareIdea(body.idea);
  } else {
    return jsonResponse(
      { error: 'invalid_input', message: 'Provide savedIdeaId or a pointspread idea object.' },
      400,
    );
  }
  try {
    const universe = await fetchRiskUniverse();
    const warnings = analyzeRisk(candidate, universe);
    return jsonResponse({ riskWarnings: warnings });
  } catch (err: any) {
    return jsonResponse(
      { error: 'analyze_risk_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleAnalyzeRiskForDraft(body: any): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  const draft = await getDraftWager(id);
  if (!draft) return jsonResponse({ error: 'not_found' }, 404);
  try {
    const universe = await fetchRiskUniverse();
    const warnings = analyzeRisk(normalizeDraft(draft), universe);
    return jsonResponse({ riskWarnings: warnings });
  } catch (err: any) {
    return jsonResponse(
      { error: 'analyze_risk_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleAnalyzeRiskForWager(body: any): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  const wager = await getWager(id);
  if (!wager) return jsonResponse({ error: 'not_found' }, 404);
  const candidate = normalizeWager(wager);
  if (!candidate) {
    return jsonResponse(
      { error: 'unsupported_kind', message: 'Only pointspread wagers are analyzed today.' },
      400,
    );
  }
  try {
    const universe = await fetchRiskUniverse();
    const warnings = analyzeRisk(candidate, universe);
    return jsonResponse({ riskWarnings: warnings });
  } catch (err: any) {
    return jsonResponse(
      { error: 'analyze_risk_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleUpdateQAStatus(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  if (!(MARKET_QA_STATUSES as readonly string[]).includes(body.status)) {
    return jsonResponse(
      {
        error: 'invalid_qa_status',
        message: `status must be one of ${MARKET_QA_STATUSES.join(', ')}`,
      },
      400,
    );
  }
  const riskOverride = parseRiskOverride(body.riskOverride);
  try {
    const actor = await getOperatorId(session ?? '');
    const updated = await updateMarketQAStatus(
      id,
      body.status as MarketQAStatus,
      actor ?? undefined,
    );
    if (!updated) return jsonResponse({ error: 'not_found' }, 404);
    if (actor) {
      try {
        await logAuditEvent({
          actor,
          eventType: 'weather_market_qa_status_changed',
          targetType: 'weather_market_qa',
          targetId: id,
          summary: `QA record ${id} (wager ${updated.wagerId}) marked ${updated.status}${riskOverride ? ` [risk override: ${riskOverride.count} high-severity warning(s) acknowledged]` : ''}.`,
          details: {
            status: updated.status,
            wagerId: updated.wagerId,
            ...(riskOverride ? { riskOverride } : {}),
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return jsonResponse({ qa: updated });
  } catch (err: any) {
    return jsonResponse(
      { error: 'update_qa_status_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

// ── Step 153 — favorite city set actions ──────────────────────────────────
//
// All three are admin-gated transitively via the existing `requireAdmin`
// at the top of the POST handler. None call `createWager` /
// `publishWager` / any wager-store mutator. None touch wallet /
// settlement / grading / pricing / Kalshi / Polymarket. The store
// itself revalidates city ids against the static universe at write
// time as a defense-in-depth check on top of these handlers' upfront
// validation. New audit events: `weather_market_city_set_created`,
// `weather_market_city_set_updated`, `weather_market_city_set_deleted`.

async function handleCreateCitySet(body: any, session: string): Promise<Response> {
  const name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim()) {
    return jsonResponse(
      { error: 'missing_name', message: 'name is required (≤80 chars).' },
      400,
    );
  }
  if (name.length > CITY_SET_NAME_MAX_LEN * 2) {
    // Defense before trim so we don't accept absurd-length payloads.
    return jsonResponse(
      { error: 'name_too_long', message: `name must be ≤${CITY_SET_NAME_MAX_LEN} chars.` },
      400,
    );
  }
  if (!Array.isArray(body.cityIds) || body.cityIds.length === 0) {
    return jsonResponse(
      { error: 'missing_city_ids', message: 'cityIds[] must be a non-empty array.' },
      400,
    );
  }
  if (body.cityIds.length > MAX_CITY_IDS_PER_SET) {
    return jsonResponse(
      {
        error: 'too_many_city_ids',
        message: `cityIds may contain at most ${MAX_CITY_IDS_PER_SET} entries.`,
        suppliedCount: body.cityIds.length,
      },
      400,
    );
  }
  // Pre-validate against the static universe so we can return a clean
  // 400 listing the unknown ids. The store ALSO re-validates at write
  // time as defense-in-depth.
  const { invalid } = validateExpandedCityIds(body.cityIds);
  if (invalid.length > 0) {
    return jsonResponse(
      {
        error: 'invalid_city_ids',
        message: 'One or more cityIds are not in the curated city universe.',
        invalidCityIds: invalid.slice(0, 10),
        totalInvalid: invalid.length,
      },
      400,
    );
  }

  try {
    const result = await createCitySet({
      name,
      cityIds: body.cityIds,
      note: typeof body.note === 'string' ? body.note : undefined,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      upsert: body.upsert === true,
    });
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      try {
        await logAuditEvent({
          actor,
          eventType: result.upserted
            ? 'weather_market_city_set_updated'
            : (result.isDuplicate
                ? 'weather_market_city_set_create_duplicate'
                : 'weather_market_city_set_created'),
          targetType: 'weather_market_city_set',
          targetId: result.citySet.id,
          summary: result.upserted
            ? `Upserted favorite city set "${result.citySet.name}" (${result.citySet.cityCount} cities).`
            : (result.isDuplicate
                ? `Duplicate create attempt for favorite city set "${result.citySet.name}" (existing id ${result.citySet.id}).`
                : `Created favorite city set "${result.citySet.name}" (${result.citySet.cityCount} cities).`),
          details: {
            cityCount: result.citySet.cityCount,
            tags: result.citySet.tags,
            isDuplicate: result.isDuplicate,
            upserted: result.upserted,
          },
        });
      } catch {
        /* non-fatal */
      }
    }
    return jsonResponse(
      {
        citySet: result.citySet,
        isDuplicate: result.isDuplicate,
        existingId: result.existingId,
        upserted: result.upserted,
      },
      result.isDuplicate && !result.upserted ? 200 : 201,
    );
  } catch (err: any) {
    return jsonResponse(
      { error: 'create_city_set_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleUpdateCitySet(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);

  if (Array.isArray(body.cityIds)) {
    if (body.cityIds.length === 0) {
      return jsonResponse(
        { error: 'empty_city_ids', message: 'cityIds[] cannot be empty.' },
        400,
      );
    }
    if (body.cityIds.length > MAX_CITY_IDS_PER_SET) {
      return jsonResponse(
        {
          error: 'too_many_city_ids',
          message: `cityIds may contain at most ${MAX_CITY_IDS_PER_SET} entries.`,
          suppliedCount: body.cityIds.length,
        },
        400,
      );
    }
    const { invalid } = validateExpandedCityIds(body.cityIds);
    if (invalid.length > 0) {
      return jsonResponse(
        {
          error: 'invalid_city_ids',
          message: 'One or more cityIds are not in the curated city universe.',
          invalidCityIds: invalid.slice(0, 10),
          totalInvalid: invalid.length,
        },
        400,
      );
    }
  }

  try {
    const updated = await updateCitySet({
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      cityIds: Array.isArray(body.cityIds) ? body.cityIds : undefined,
      note: body.note === null ? null : (typeof body.note === 'string' ? body.note : undefined),
      tags: body.tags === null ? null : (Array.isArray(body.tags) ? body.tags : undefined),
    });
    if (!updated) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      try {
        await logAuditEvent({
          actor,
          eventType: 'weather_market_city_set_updated',
          targetType: 'weather_market_city_set',
          targetId: id,
          summary: `Updated favorite city set "${updated.name}" (${updated.cityCount} cities).`,
          details: { cityCount: updated.cityCount, tags: updated.tags },
        });
      } catch {
        /* non-fatal */
      }
    }
    return jsonResponse({ citySet: updated });
  } catch (err: any) {
    return jsonResponse(
      { error: 'update_city_set_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}

async function handleDeleteCitySet(body: any, session: string): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return jsonResponse({ error: 'missing_id' }, 400);
  try {
    const ok = await deleteCitySet(id);
    if (!ok) return jsonResponse({ error: 'not_found' }, 404);
    const actor = await getOperatorId(session ?? '');
    if (actor) {
      try {
        await logAuditEvent({
          actor,
          eventType: 'weather_market_city_set_deleted',
          targetType: 'weather_market_city_set',
          targetId: id,
          summary: `Deleted favorite city set ${id}.`,
        });
      } catch {
        /* non-fatal */
      }
    }
    return jsonResponse({ ok: true });
  } catch (err: any) {
    return jsonResponse(
      { error: 'delete_city_set_failed', message: err?.message ?? String(err) },
      500,
    );
  }
}
