// ── Step 144 / 145 / 146: Weather Market Idea Generator (admin-only UI) ──
//
// Generates draft cross-location pointspread ideas from current forecast
// data and (Step 146) lets the admin save promising ones to a review
// queue. **Idea-only.** No publish button, no market creation. The
// only way to actually create a market is for the operator to follow
// the prefilled "Use this idea →" link to the existing wager-create
// form and click Create Wager themselves.
//
// Step 145: target-difference search workflow + assisted prefill link.
// Step 146: saved-idea review queue with statuses
//           (saved | reviewed | rejected | used), operator notes,
//           and duplicate detection.

import React, { useEffect, useMemo, useState } from 'react';
import SystemNav from './SystemNav';

const card: React.CSSProperties = { background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 };
const tile: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 12 };
const btn = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, border: 'none', background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 });
const link = (bg: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 6, background: bg, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'inline-block' });
const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', padding: '6px 8px', borderRadius: 6, fontSize: 12 };
const textareaStyle: React.CSSProperties = { ...input, minHeight: 60, fontFamily: 'inherit', resize: 'vertical' };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', marginBottom: 4, display: 'block' };
const sectionHeader: React.CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' };
const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 6,
  border: 'none',
  background: active ? '#0e7490' : '#334155',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
});

const BANNER: React.CSSProperties = {
  background: 'linear-gradient(90deg, #7f1d1d, #b91c1c)',
  color: '#fff',
  padding: '10px 14px',
  borderRadius: 8,
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

interface SeedCity {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

type IdeaMetric = 'daily_high' | 'daily_low';
type ConfidenceLabel = 'higher' | 'medium' | 'lower';
type MetricPairOption = 'high_vs_high' | 'low_vs_low' | 'high_vs_low' | 'any_temperature_pair';
type SavedIdeaStatus = 'saved' | 'reviewed' | 'rejected' | 'used';
type MarketQAStatus = 'pending' | 'passed' | 'needs_changes' | 'rejected';

// Step 152 / 153 / 154 — bounded city universe types (mirror server).
type WeatherPersonalityTag =
  | 'hot' | 'cold' | 'humid' | 'dry' | 'desert' | 'mountain' | 'coastal'
  | 'plains' | 'windy' | 'snowy' | 'rainy' | 'storm_prone' | 'hurricane_exposed'
  | 'lake_effect' | 'high_variability' | 'big_diurnal_swing' | 'heat_index'
  | 'freeze_risk' | 'severe_weather' | 'urban_heat';
type TagMode = 'any' | 'all';

const TAG_LABELS: Record<WeatherPersonalityTag, string> = {
  hot: 'Hot',
  cold: 'Cold',
  humid: 'Humid',
  dry: 'Dry',
  desert: 'Desert',
  mountain: 'Mountain',
  coastal: 'Coastal',
  plains: 'Plains',
  windy: 'Windy',
  snowy: 'Snowy',
  rainy: 'Rainy',
  storm_prone: 'Storm-prone',
  hurricane_exposed: 'Hurricane-exposed',
  lake_effect: 'Lake-effect',
  high_variability: 'High variability',
  big_diurnal_swing: 'Big diurnal swing',
  heat_index: 'High heat index',
  freeze_risk: 'Freeze risk',
  severe_weather: 'Severe weather',
  urban_heat: 'Urban heat',
};

interface SmartDiscoveryPreset {
  id: string;
  label: string;
  description: string;
  tags?: WeatherPersonalityTag[];
  tagMode?: TagMode;
  cityIds?: string[];
  region?: string;
  metricPair?: 'high_vs_high' | 'low_vs_low' | 'high_vs_low' | 'any_temperature_pair';
  targetDifferenceF?: number;
  toleranceF?: number;
  dayOffset?: number;
}

// Step 155 — operator-feedback types (mirror server).
type FeedbackRating = 'useful' | 'not_useful' | 'neutral';
type FeedbackReason =
  | 'good_candidate'
  | 'too_boring'
  | 'too_extreme'
  | 'bad_city_pair'
  | 'unclear_market'
  | 'duplicate'
  | 'wrong_metric_pair'
  | 'poor_forecast_confidence'
  | 'other';

const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  good_candidate: 'Good candidate',
  too_boring: 'Too boring',
  too_extreme: 'Too extreme',
  bad_city_pair: 'Bad city pair',
  unclear_market: 'Unclear market',
  duplicate: 'Duplicate of existing market',
  wrong_metric_pair: 'Wrong metric pair',
  poor_forecast_confidence: 'Poor forecast confidence',
  other: 'Other',
};

interface FeedbackGroupSummary {
  key: string;
  totalCount: number;
  usefulCount: number;
  notUsefulCount: number;
  neutralCount: number;
  usefulRate: number | null;
  topNegativeReasons: Array<{ reason: FeedbackReason; count: number }>;
  tuningNote: string;
}

interface FeedbackSummary {
  totalFeedback: number;
  byRating: Record<FeedbackRating, number>;
  byReason: Record<FeedbackReason, number>;
  byPreset: FeedbackGroupSummary[];
  byTag: FeedbackGroupSummary[];
  byMetricPair: FeedbackGroupSummary[];
  byTargetDifferenceBucket: FeedbackGroupSummary[];
  topLevelNotes: string[];
}

interface ExpandedCity {
  id: string;
  label: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  region: string;
  populationRank?: number;
  tags?: WeatherPersonalityTag[];
}

interface WeatherMarketCitySet {
  id: string;
  name: string;
  normalizedName: string;
  createdAt: string;
  updatedAt: string;
  cityIds: string[];
  cityCount: number;
  note?: string;
  tags?: string[];
  source: 'admin';
}

type CityUniverseMode = 'seed_12' | 'expanded_us';
type CityRegionFilter =
  | 'all_expanded'
  | 'northeast'
  | 'southeast'
  | 'midwest'
  | 'plains'
  | 'mountain'
  | 'southwest'
  | 'west_coast'
  | 'pacific_northwest'
  | 'texas'
  | 'florida';

const CITY_UNIVERSE_LABELS: Record<CityUniverseMode, string> = {
  seed_12: 'Seed cities (12)',
  expanded_us: 'Expanded US cities',
};

const CITY_REGION_LABELS: Record<CityRegionFilter, string> = {
  all_expanded: 'All regions',
  northeast: 'Northeast',
  southeast: 'Southeast',
  midwest: 'Midwest',
  plains: 'Plains',
  mountain: 'Mountain',
  southwest: 'Southwest',
  west_coast: 'West Coast',
  pacific_northwest: 'Pacific Northwest',
  texas: 'Texas',
  florida: 'Florida',
};

// Step 150 — risk-warning UI types (mirror server).
type RiskSeverity = 'info' | 'warning' | 'high';
type RiskWarningType =
  | 'exact_duplicate'
  | 'similar_market'
  | 'same_location_date_metric'
  | 'same_location_cluster'
  | 'same_date_cluster'
  | 'correlated_temperature_spread'
  | 'repeated_city_pair'
  | 'same_spread_nearby_line'
  | 'high_existing_activity';
interface WeatherMarketRiskWarning {
  id: string;
  severity: RiskSeverity;
  type: RiskWarningType;
  title: string;
  description: string;
  relatedIds: string[];
  relatedTitles: string[];
  suggestedAction: string;
}
const RISK_SEVERITY_TONE: Record<RiskSeverity, string> = {
  high: '#dc2626',
  warning: '#f97316',
  info: '#0ea5e9',
};
// Step 151 — extract the high-severity warnings (if any) from a risk-warning
// list. Returned array preserves order so the modal renders them as the
// analyzer ordered them (exact_duplicate first, then near-spread, etc.).
function highSeverityWarnings(warnings: WeatherMarketRiskWarning[] | undefined): WeatherMarketRiskWarning[] {
  if (!warnings || warnings.length === 0) return [];
  return warnings.filter((w) => w.severity === 'high');
}

// Compact override metadata sent with the action payload when the
// operator confirms past a high-severity warning. Server merges this
// into the existing audit-event details.
interface RiskOverridePayload {
  confirmed: true;
  types: string[];
  count: number;
}

function buildRiskOverride(highs: WeatherMarketRiskWarning[]): RiskOverridePayload | undefined {
  if (highs.length === 0) return undefined;
  return {
    confirmed: true,
    types: Array.from(new Set(highs.map((w) => w.type))),
    count: highs.length,
  };
}

function RiskBadges({ warnings }: { warnings: WeatherMarketRiskWarning[] | undefined }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <details
      style={{
        marginTop: 8,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '6px 8px',
      }}
    >
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginRight: 4 }}>
          Risk warnings ({warnings.length}):
        </span>
        {warnings.map((w) => (
          <span
            key={w.id}
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#fff',
              background: RISK_SEVERITY_TONE[w.severity],
              padding: '2px 6px',
              borderRadius: 999,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
            title={w.title}
          >
            {w.severity}
          </span>
        ))}
        <span style={{ fontSize: 10, color: '#94a3b8' }}>(click to expand)</span>
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {warnings.map((w) => (
          <div
            key={w.id + '-detail'}
            style={{
              fontSize: 11,
              color: '#e2e8f0',
              borderLeft: `3px solid ${RISK_SEVERITY_TONE[w.severity]}`,
              paddingLeft: 8,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              <span style={{ color: RISK_SEVERITY_TONE[w.severity], textTransform: 'uppercase', marginRight: 6 }}>
                {w.severity}
              </span>
              {w.title}
            </div>
            <div style={{ color: '#cbd5e1', marginTop: 2 }}>{w.description}</div>
            {w.relatedTitles.length > 0 && (
              <ul style={{ marginTop: 4, paddingLeft: 16, color: '#94a3b8' }}>
                {w.relatedTitles.slice(0, 5).map((t, i) => (
                  <li key={`${w.id}-rel-${i}`}>
                    {t || w.relatedIds[i]}
                    <span style={{ color: '#64748b', fontSize: 10, marginLeft: 6, fontFamily: 'monospace' }}>
                      ({w.relatedIds[i]})
                    </span>
                  </li>
                ))}
                {w.relatedTitles.length > 5 && (
                  <li style={{ color: '#64748b' }}>+ {w.relatedTitles.length - 5} more</li>
                )}
              </ul>
            )}
            <div style={{ color: '#94a3b8', fontStyle: 'italic', marginTop: 2 }}>
              Warning only — admin may still proceed. Suggested: {w.suggestedAction}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

interface MarketQAChecklist {
  titleReviewed: boolean;
  locationsReviewed: boolean;
  metricsReviewed: boolean;
  spreadReviewed: boolean;
  oddsReviewed: boolean;
  rulesReviewed: boolean;
  resolutionSourceReviewed: boolean;
  publicPageReviewed: boolean;
  mobileDisplayReviewed: boolean;
}

interface MarketQA {
  id: string;
  wagerId: string;
  sourceDraftId: string;
  sourceIdeaId: string;
  createdAt: string;
  updatedAt: string;
  status: MarketQAStatus;
  checklist: MarketQAChecklist;
  snapshot: {
    title: string;
    targetDate: string;
    metric: string;
    metricA?: string;
    metricB?: string;
    locationAName?: string;
    locationBName?: string;
    spread?: number;
    locationAOdds?: number;
    locationBOdds?: number;
  };
  operatorNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

const QA_STATUS_LABELS: Record<MarketQAStatus, string> = {
  pending: 'Pending',
  passed: 'Passed',
  needs_changes: 'Needs changes',
  rejected: 'Rejected',
};

const QA_STATUS_TONES: Record<MarketQAStatus, string> = {
  pending: '#fbbf24',
  passed: '#22c55e',
  needs_changes: '#f97316',
  rejected: '#94a3b8',
};

// Operator-facing copy for each checklist item. Edit this without
// bumping the schema — booleans are the only thing persisted.
const CHECKLIST_ITEMS: Array<{ key: keyof MarketQAChecklist; label: string; help: string }> = [
  {
    key: 'titleReviewed',
    label: 'Title',
    help: 'Title clearly states both sides and the target date.',
  },
  {
    key: 'locationsReviewed',
    label: 'Locations',
    help: 'City/state and weather stations are correct for both sides.',
  },
  {
    key: 'metricsReviewed',
    label: 'Metrics',
    help: 'metricA / metricB are correct and rendered clearly (e.g. "High" vs "Low").',
  },
  {
    key: 'spreadReviewed',
    label: 'Spread',
    help: 'Line matches the intended forecast difference and direction.',
  },
  {
    key: 'oddsReviewed',
    label: 'Odds',
    help: 'Odds are correct, intentional, and balanced for the desired hold.',
  },
  {
    key: 'rulesReviewed',
    label: 'Rules',
    help: 'Push / tie / inclusive-boundary language is clear and unambiguous.',
  },
  {
    key: 'resolutionSourceReviewed',
    label: 'Resolution source',
    help: 'Authoritative observation source (NWS) is referenced and visible.',
  },
  {
    key: 'publicPageReviewed',
    label: 'Public page',
    help: 'Public detail page renders correctly and is understandable to a customer.',
  },
  {
    key: 'mobileDisplayReviewed',
    label: 'Mobile display',
    help: 'Market is readable and the bet flow is usable on mobile.',
  },
];

function emptyChecklist(): MarketQAChecklist {
  return {
    titleReviewed: false,
    locationsReviewed: false,
    metricsReviewed: false,
    spreadReviewed: false,
    oddsReviewed: false,
    rulesReviewed: false,
    resolutionSourceReviewed: false,
    publicPageReviewed: false,
    mobileDisplayReviewed: false,
  };
}

const METRIC_PAIR_LABELS: Record<MetricPairOption, string> = {
  any_temperature_pair: 'Any temperature pair',
  high_vs_high: 'High vs High',
  low_vs_low: 'Low vs Low',
  high_vs_low: 'High vs Low (cross-metric)',
};

const STATUS_LABELS: Record<SavedIdeaStatus, string> = {
  saved: 'Saved',
  reviewed: 'Reviewed',
  rejected: 'Rejected',
  used: 'Used',
};

const STATUS_TONES: Record<SavedIdeaStatus, string> = {
  saved: '#0ea5e9',
  reviewed: '#a78bfa',
  rejected: '#94a3b8',
  used: '#22c55e',
};

interface IdeaLocation {
  id: string;
  label: string;
  lat: number;
  lon: number;
  region: string;
}

// Step 156 — admin-only interestingness label set (mirrors server).
type InterestingnessLabel =
  | 'high_interest'
  | 'promising'
  | 'neutral'
  | 'low_signal'
  | 'insufficient_history';

interface OutcomeInterestingness {
  score: number;
  label: InterestingnessLabel;
  reasons: string[];
  sampleCount: number;
}

const INTERESTINGNESS_LABEL_COPY: Record<InterestingnessLabel, string> = {
  high_interest: 'High interest',
  promising: 'Promising',
  neutral: 'Neutral',
  low_signal: 'Low signal',
  insufficient_history: 'Insufficient history',
};

const INTERESTINGNESS_TONE: Record<InterestingnessLabel, string> = {
  high_interest: '#22c55e',
  promising: '#0ea5e9',
  neutral: '#94a3b8',
  low_signal: '#fbbf24',
  insufficient_history: '#475569',
};

interface WeatherMarketIdea {
  id: string;
  title: string;
  description: string;
  kind: 'pointspread';
  locationA: IdeaLocation;
  locationB: IdeaLocation;
  metricA: IdeaMetric;
  metricB: IdeaMetric;
  targetDate: string;
  forecastValueA: number;
  forecastValueB: number;
  rawDifference: number;
  absDifference: number;
  suggestedSpread: number;
  suggestedOddsA: number;
  suggestedOddsB: number;
  confidenceLabel: ConfidenceLabel;
  rationale: string;
  warnings: string[];
  status: 'idea_only';
  setupNotes: string;
  interestingnessScore: number;
  closenessToTarget?: number;
  prefillQuery: string;
  /** Step 156 — admin-only operator-interestingness rating. NOT betting advice. */
  outcomeInterestingness?: OutcomeInterestingness;
}

interface GenerateResult {
  generatedAt: string;
  targetDate: string;
  cityCount: number;
  ideas: WeatherMarketIdea[];
  warnings: string[];
  resolved: {
    metricPair: MetricPairOption;
    targetDifferenceF?: number;
    toleranceF?: number;
    cityUniverse: CityUniverseMode;
    region: CityRegionFilter;
    candidateSet: string;
    cityIds: string[];
    candidateCityCount: number;
    successfulForecastCount: number;
    failedForecastCount: number;
    cityCountCappedTo?: number;
    weatherTags?: WeatherPersonalityTag[];
    tagMode?: TagMode;
    tagFilteredCityCount?: number;
  };
}

interface SavedIdeaSearchContext {
  targetDifferenceF?: number;
  toleranceF?: number;
  dayOffset?: number;
  metricPair?: MetricPairOption;
}

interface SavedWeatherMarketIdea {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SavedIdeaStatus;
  idea: WeatherMarketIdea;
  operatorNote?: string;
  source: 'generator';
  searchContext?: SavedIdeaSearchContext;
  prefillQuery: string;
  warningFlags: string[];
  fingerprint: string;
}

interface BootstrapResponse {
  seedCities: SeedCity[];
  metricPairOptions: MetricPairOption[];
  savedIdeaStatuses: SavedIdeaStatus[];
  qaStatuses: MarketQAStatus[];
  // Step 152 — bounded city-universe metadata.
  cityUniverseOptions?: CityUniverseMode[];
  regionOptions?: CityRegionFilter[];
  expandedUsCityCount?: number;
  expandedRegionCounts?: Record<CityRegionFilter, number>;
  // Step 153 — full curated catalog for the searchable picker.
  expandedCities?: ExpandedCity[];
  // Step 154 — weather personality tag taxonomy + presets.
  weatherPersonalityTags?: WeatherPersonalityTag[];
  tagModes?: TagMode[];
  expandedCityCountsByTag?: Record<WeatherPersonalityTag, number>;
  smartDiscoveryPresets?: SmartDiscoveryPreset[];
  limits: {
    targetDifferenceFMax: number;
    toleranceFMax: number;
    maxResultsCap: number;
    savedIdeasCap: number;
    operatorNoteMaxLen: number;
    draftWagersCap: number;
    draftOperatorNoteMaxLen: number;
    qaRecordsCap: number;
    qaOperatorNoteMaxLen: number;
    maxCandidateCitiesCap?: number;
    defaultExpandedCandidateCities?: number;
    // Step 153 — favorite city set caps.
    citySetsCap?: number;
    citySetNameMaxLen?: number;
    citySetNoteMaxLen?: number;
    maxCityIdsPerSet?: number;
    maxCitySetTags?: number;
  };
}

// Step 147 — admin draft wager (lives in its own Redis namespace, never
// exposed to customers). Mirrors the server-side DraftWager shape.
interface DraftWagerSummary {
  title: string;
  description?: string;
  kind: 'pointspread';
  metric: string;
  metricA?: string;
  metricB?: string;
  targetDate: string;
  locationAName?: string;
  locationBName?: string;
  spread?: number;
  locationAOdds?: number;
  locationBOdds?: number;
  rulesCopy: string;
  warnings: string[];
}

interface DraftWager {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'published';
  summary: DraftWagerSummary;
  provenance: {
    savedIdeaId: string;
    ideaId: string;
    ideaFingerprint: string;
  };
  operatorNote?: string;
  // Step 148 — set after the draft has been published.
  publishedAt?: string;
  publishedWagerId?: string;
}

const API = '/api/admin/system/weather-market-ideas';

const METRIC_LABELS: Record<IdeaMetric, string> = {
  daily_high: 'High',
  daily_low: 'Low',
};

function defaultTargetDate(daysAhead = 1): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function copyToClipboard(text: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {});
}

function confidenceTone(label: ConfidenceLabel): string {
  if (label === 'higher') return '#22c55e';
  if (label === 'medium') return '#fbbf24';
  return '#94a3b8';
}

export default function WeatherMarketIdeaGenerator() {
  const [tab, setTab] = useState<'generate' | 'saved' | 'drafts' | 'qa'>('generate');
  const [seedCities, setSeedCities] = useState<SeedCity[]>([]);
  const [metricPairOptions, setMetricPairOptions] = useState<MetricPairOption[]>([
    'any_temperature_pair', 'high_vs_high', 'low_vs_low', 'high_vs_low',
  ]);
  const [statusOptions, setStatusOptions] = useState<SavedIdeaStatus[]>([
    'saved', 'reviewed', 'rejected', 'used',
  ]);
  const [qaStatusOptions, setQaStatusOptions] = useState<MarketQAStatus[]>([
    'pending', 'passed', 'needs_changes', 'rejected',
  ]);
  const [limits, setLimits] = useState<BootstrapResponse['limits']>({
    targetDifferenceFMax: 80,
    toleranceFMax: 20,
    maxResultsCap: 100,
    savedIdeasCap: 300,
    operatorNoteMaxLen: 1000,
    draftWagersCap: 200,
    draftOperatorNoteMaxLen: 1000,
    qaRecordsCap: 300,
    qaOperatorNoteMaxLen: 1000,
    maxCandidateCitiesCap: 100,
    defaultExpandedCandidateCities: 75,
    citySetsCap: 100,
    citySetNameMaxLen: 80,
    citySetNoteMaxLen: 500,
    maxCityIdsPerSet: 100,
    maxCitySetTags: 8,
  });

  // Step 152 — universe selector + region filter + expansion-cap state.
  const [cityUniverseOptions, setCityUniverseOptions] = useState<CityUniverseMode[]>([
    'seed_12', 'expanded_us',
  ]);
  const [regionOptions, setRegionOptions] = useState<CityRegionFilter[]>([
    'all_expanded', 'northeast', 'southeast', 'midwest', 'plains',
    'mountain', 'southwest', 'west_coast', 'pacific_northwest', 'texas', 'florida',
  ]);
  const [expandedUsCityCount, setExpandedUsCityCount] = useState<number>(75);
  const [expandedRegionCounts, setExpandedRegionCounts] = useState<Partial<Record<CityRegionFilter, number>>>({});
  const [cityUniverse, setCityUniverse] = useState<CityUniverseMode>('seed_12');
  const [regionFilter, setRegionFilter] = useState<CityRegionFilter>('all_expanded');
  const [maxCandidateCities, setMaxCandidateCities] = useState<string>('75');

  // Step 153 — searchable picker + favorite city sets state.
  const [expandedCities, setExpandedCities] = useState<ExpandedCity[]>([]);
  const [pickerSearch, setPickerSearch] = useState<string>('');
  const [selectedExpandedCityIds, setSelectedExpandedCityIds] = useState<string[]>([]);
  const [citySets, setCitySets] = useState<WeatherMarketCitySet[]>([]);
  const [citySetsLoading, setCitySetsLoading] = useState(false);
  const [citySetsError, setCitySetsError] = useState<string | null>(null);
  const [citySetBusyId, setCitySetBusyId] = useState<string | null>(null);
  const [newSetName, setNewSetName] = useState<string>('');
  const [newSetNote, setNewSetNote] = useState<string>('');
  const [newSetTagsInput, setNewSetTagsInput] = useState<string>('');
  const [newSetUpsert, setNewSetUpsert] = useState<boolean>(false);
  const [citySetFlash, setCitySetFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Step 156 — sort selector for the generated-ideas grid. 'default'
  // preserves the generator's own order; the other two sort the
  // displayed slice without re-running the generator.
  const [ideaSortMode, setIdeaSortMode] = useState<'default' | 'closest' | 'interestingness'>('default');

  // Step 155 — feedback state. Per-idea local cache so the UI knows
  // which ideas already have feedback (avoids accidental dupe spam).
  const [feedbackRatings, setFeedbackRatings] = useState<FeedbackRating[]>([
    'useful', 'not_useful', 'neutral',
  ]);
  const [feedbackReasonsList, setFeedbackReasonsList] = useState<FeedbackReason[]>([
    'good_candidate', 'too_boring', 'too_extreme', 'bad_city_pair',
    'unclear_market', 'duplicate', 'wrong_metric_pair',
    'poor_forecast_confidence', 'other',
  ]);
  const [submittedFeedback, setSubmittedFeedback] = useState<Record<string, { rating: FeedbackRating; reason?: FeedbackReason }>>({});
  const [pendingNotUsefulIdeaId, setPendingNotUsefulIdeaId] = useState<string | null>(null);
  const [pendingReason, setPendingReason] = useState<FeedbackReason>('too_boring');
  const [pendingNote, setPendingNote] = useState<string>('');
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary | null>(null);
  const [feedbackSummaryLoading, setFeedbackSummaryLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Step 154 — weather personality tags + smart-discovery presets state.
  const [weatherPersonalityTags, setWeatherPersonalityTags] = useState<WeatherPersonalityTag[]>([
    'hot', 'cold', 'humid', 'dry', 'desert', 'mountain', 'coastal', 'plains',
    'windy', 'snowy', 'rainy', 'storm_prone', 'hurricane_exposed', 'lake_effect',
    'high_variability', 'big_diurnal_swing', 'heat_index', 'freeze_risk',
    'severe_weather', 'urban_heat',
  ]);
  const [tagModeOptions, setTagModeOptions] = useState<TagMode[]>(['any', 'all']);
  const [tagCounts, setTagCounts] = useState<Partial<Record<WeatherPersonalityTag, number>>>({});
  const [smartPresets, setSmartPresets] = useState<SmartDiscoveryPreset[]>([]);
  const [selectedTags, setSelectedTags] = useState<WeatherPersonalityTag[]>([]);
  const [tagMode, setTagMode] = useState<TagMode>('any');
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string>(defaultTargetDate(1));
  const [selectedCityIds, setSelectedCityIds] = useState<Record<string, boolean>>({});
  const [metricPair, setMetricPair] = useState<MetricPairOption>('any_temperature_pair');
  const [useTargetDifference, setUseTargetDifference] = useState<boolean>(false);
  const [targetDifferenceF, setTargetDifferenceF] = useState<string>('20');
  const [toleranceF, setToleranceF] = useState<string>('3');
  const [maxResults, setMaxResults] = useState<string>('20');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Step 146 — saved-idea queue state.
  const [savedIdeas, setSavedIdeas] = useState<SavedWeatherMarketIdea[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedFilter, setSavedFilter] = useState<SavedIdeaStatus | 'all'>('all');
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedBusyId, setSavedBusyId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [saveFlash, setSaveFlash] = useState<{ ideaId: string; isDuplicate: boolean } | null>(null);

  // Step 147 — admin draft-wager queue.
  const [draftWagers, setDraftWagers] = useState<DraftWager[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [draftBusyId, setDraftBusyId] = useState<string | null>(null);
  // Confirmation modal for "Create Draft Wager" — keyed by saved idea id.
  const [draftConfirm, setDraftConfirm] = useState<SavedWeatherMarketIdea | null>(null);
  const [draftFlash, setDraftFlash] = useState<{ savedIdeaId: string; draftId?: string; error?: string; existingDraftId?: string } | null>(null);

  // Step 148 — publish state.
  const [publishConfirm, setPublishConfirm] = useState<DraftWager | null>(null);
  const [publishFlash, setPublishFlash] = useState<{
    draftId: string;
    publishedWagerId?: string;
    publishedTitle?: string;
    error?: string;
    existingWagerId?: string;
    warning?: string;
    qaId?: string;
  } | null>(null);

  // Step 149 — QA state.
  const [qaList, setQaList] = useState<MarketQA[]>([]);
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaBusyId, setQaBusyId] = useState<string | null>(null);
  const [qaFilter, setQaFilter] = useState<MarketQAStatus | 'all'>('all');
  const [qaChecklistDrafts, setQaChecklistDrafts] = useState<Record<string, MarketQAChecklist>>({});
  const [qaNoteDrafts, setQaNoteDrafts] = useState<Record<string, string>>({});

  // Step 150 — risk warnings, keyed by source-record id (idea / saved-idea / draft / qa).
  const [generateRiskMap, setGenerateRiskMap] = useState<Record<string, WeatherMarketRiskWarning[]>>({});
  const [savedRiskMap, setSavedRiskMap] = useState<Record<string, WeatherMarketRiskWarning[]>>({});
  const [draftRiskMap, setDraftRiskMap] = useState<Record<string, WeatherMarketRiskWarning[]>>({});
  const [qaRiskMap, setQaRiskMap] = useState<Record<string, WeatherMarketRiskWarning[]>>({});

  // ── Step 151 — soft confirmation modal for high-severity warnings ────────
  //
  // **Advisory only.** This modal NEVER hard-blocks an action — every
  // path here ends in either Cancel or "Continue anyway", which proceeds
  // exactly as if no warnings were present. The Step 147/148 server-side
  // duplicate guards (`draft_already_exists`, `draft_already_published`)
  // remain in force and are the only places anything is truly blocked.
  // Severity-based button disabling is forbidden by spec — verified by
  // grep: no `disabled=` here is keyed off risk severity.
  const [highSevConfirm, setHighSevConfirm] = useState<{
    actionLabel: string;          // "Save idea" / "Create draft wager" / "Publish draft" / "Mark QA passed"
    candidateTitle: string;       // Card title so the operator knows which item
    warnings: WeatherMarketRiskWarning[];
    onConfirm: () => void;
  } | null>(null);

  // Staging slots for risk-override metadata that needs to be picked
  // up by an existing modal flow (Steps 147 / 148). Cleared after the
  // downstream action reads it. One pending action at a time per slot.
  const [pendingDraftRiskOverride, setPendingDraftRiskOverride] = useState<{
    savedIdeaId: string;
    override?: RiskOverridePayload;
  } | null>(null);
  const [pendingPublishRiskOverride, setPendingPublishRiskOverride] = useState<{
    draftId: string;
    override?: RiskOverridePayload;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(API);
        const j = (await r.json()) as BootstrapResponse & { message?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(j.message ?? 'load failed');
        setSeedCities(j.seedCities ?? []);
        if (Array.isArray(j.metricPairOptions) && j.metricPairOptions.length > 0) {
          setMetricPairOptions(j.metricPairOptions);
        }
        if (Array.isArray(j.savedIdeaStatuses) && j.savedIdeaStatuses.length > 0) {
          setStatusOptions(j.savedIdeaStatuses);
        }
        if (Array.isArray(j.qaStatuses) && j.qaStatuses.length > 0) {
          setQaStatusOptions(j.qaStatuses);
        }
        if (Array.isArray(j.cityUniverseOptions) && j.cityUniverseOptions.length > 0) {
          setCityUniverseOptions(j.cityUniverseOptions);
        }
        if (Array.isArray(j.regionOptions) && j.regionOptions.length > 0) {
          setRegionOptions(j.regionOptions);
        }
        if (typeof j.expandedUsCityCount === 'number') {
          setExpandedUsCityCount(j.expandedUsCityCount);
        }
        if (j.expandedRegionCounts && typeof j.expandedRegionCounts === 'object') {
          setExpandedRegionCounts(j.expandedRegionCounts);
        }
        if (Array.isArray(j.expandedCities)) {
          setExpandedCities(j.expandedCities);
        }
        if (Array.isArray(j.weatherPersonalityTags) && j.weatherPersonalityTags.length > 0) {
          setWeatherPersonalityTags(j.weatherPersonalityTags);
        }
        if (Array.isArray(j.tagModes) && j.tagModes.length > 0) {
          setTagModeOptions(j.tagModes);
        }
        if (j.expandedCityCountsByTag && typeof j.expandedCityCountsByTag === 'object') {
          setTagCounts(j.expandedCityCountsByTag);
        }
        if (Array.isArray(j.smartDiscoveryPresets)) {
          setSmartPresets(j.smartDiscoveryPresets);
        }
        if (Array.isArray(j.feedbackRatings) && j.feedbackRatings.length > 0) {
          setFeedbackRatings(j.feedbackRatings);
        }
        if (Array.isArray(j.feedbackReasons) && j.feedbackReasons.length > 0) {
          setFeedbackReasonsList(j.feedbackReasons);
        }
        if (j.limits?.defaultExpandedCandidateCities) {
          setMaxCandidateCities(String(j.limits.defaultExpandedCandidateCities));
        }
        if (j.limits) setLimits(j.limits);
        const all: Record<string, boolean> = {};
        for (const c of j.seedCities ?? []) all[c.id] = true;
        setSelectedCityIds(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cityIdsToInclude = useMemo(() => {
    return Object.entries(selectedCityIds)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [selectedCityIds]);

  async function loadSavedIdeas(filter: SavedIdeaStatus | 'all') {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const url = filter === 'all'
        ? `${API}?action=list-saved-ideas&limit=200`
        : `${API}?action=list-saved-ideas&status=${encodeURIComponent(filter)}&limit=200`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setSavedIdeas(j.savedIdeas ?? []);
      setSavedRiskMap(j.riskWarnings ?? {});
    } catch (e: any) {
      setSavedError(e?.message ?? 'load failed');
    } finally {
      setSavedLoading(false);
    }
  }

  // Refresh the saved list whenever the user switches into the tab or
  // changes the filter. A fresh fetch is cheap and avoids stale state
  // after the operator saves/changes status from the Generate tab.
  useEffect(() => {
    if (tab !== 'saved') return;
    loadSavedIdeas(savedFilter);
  }, [tab, savedFilter]);

  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      // Step 153 — in expanded mode, an explicit selection overrides
      // the region filter. The server validates every id against the
      // static universe before the generator runs (400 invalid_city_ids
      // on any unknown id), so a typo here is rejected cleanly and a
      // hostile client cannot add arbitrary lat/lon by abusing this
      // field.
      const expandedSelectionActive =
        cityUniverse === 'expanded_us' && selectedExpandedCityIds.length > 0;
      const body: any = {
        action: 'generate',
        targetDate,
        cityIds: expandedSelectionActive
          ? selectedExpandedCityIds
          : (cityUniverse === 'seed_12' && cityIdsToInclude.length !== seedCities.length
              ? cityIdsToInclude
              : undefined),
        metricPair,
        maxResults: maxResults ? Number(maxResults) : undefined,
        cityUniverse,
        ...(cityUniverse === 'expanded_us'
          ? {
              // Skip the region filter when an explicit selection is
              // present — the operator's targeted list IS the filter.
              region: expandedSelectionActive ? undefined : regionFilter,
              maxCandidateCities: maxCandidateCities ? Number(maxCandidateCities) : undefined,
              // Step 154 — tags/tagMode are applied only when no explicit
              // selection is active (selection always wins). The audit
              // event still records the presetId regardless of whether
              // tags were applied so we know what the operator started from.
              ...(!expandedSelectionActive && selectedTags.length > 0
                ? { weatherTags: selectedTags, tagMode }
                : {}),
              ...(activePresetId ? { presetId: activePresetId } : {}),
            }
          : {}),
      };
      if (useTargetDifference) {
        body.targetDifferenceF = targetDifferenceF ? Number(targetDifferenceF) : undefined;
        body.toleranceF = toleranceF ? Number(toleranceF) : undefined;
      }
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'generate failed');
      setResult(j.result ?? null);
      setGenerateRiskMap(j.riskWarnings ?? {});
    } catch (e: any) {
      setError(e?.message ?? 'generate failed');
    } finally {
      setBusy(false);
    }
  }

  function buildSearchContext(): SavedIdeaSearchContext | undefined {
    const ctx: SavedIdeaSearchContext = {};
    if (useTargetDifference) {
      if (targetDifferenceF) ctx.targetDifferenceF = Number(targetDifferenceF);
      if (toleranceF) ctx.toleranceF = Number(toleranceF);
    }
    ctx.metricPair = metricPair;
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }

  async function performSaveGeneratedIdea(idea: WeatherMarketIdea, riskOverride?: RiskOverridePayload) {
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-idea',
          idea,
          searchContext: buildSearchContext(),
          ...(riskOverride ? { riskOverride } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'save failed');
      setSaveFlash({ ideaId: idea.id, isDuplicate: !!j.isDuplicate });
      setTimeout(() => setSaveFlash(null), 2500);
      // Don't auto-switch tabs — operator may want to keep saving.
    } catch (e: any) {
      setSavedError(e?.message ?? 'save failed');
    }
  }

  function onSaveGeneratedIdea(idea: WeatherMarketIdea) {
    // Step 151 — soft confirmation when this idea has high-severity
    // warnings. If none, proceed directly. If any, pop the modal and
    // let the operator decide; on Continue, pass the override metadata
    // so the server audit log records the bypass.
    const highs = highSeverityWarnings(generateRiskMap[idea.id]);
    if (highs.length === 0) {
      void performSaveGeneratedIdea(idea);
      return;
    }
    setHighSevConfirm({
      actionLabel: 'Save idea',
      candidateTitle: idea.title,
      warnings: highs,
      onConfirm: () => {
        setHighSevConfirm(null);
        void performSaveGeneratedIdea(idea, buildRiskOverride(highs));
      },
    });
  }

  async function onUpdateStatus(id: string, status: SavedIdeaStatus) {
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-saved-idea-status', id, status }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'update failed');
      setSavedIdeas((prev) => prev.map((s) => (s.id === id ? j.savedIdea : s)));
    } catch (e: any) {
      setSavedError(e?.message ?? 'update failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  async function onUpdateNote(id: string) {
    const note = draftNotes[id] ?? '';
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-saved-idea-note', id, note }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'update failed');
      setSavedIdeas((prev) => prev.map((s) => (s.id === id ? j.savedIdea : s)));
      setDraftNotes((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e: any) {
      setSavedError(e?.message ?? 'update failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  async function onDeleteSaved(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this saved idea? This cannot be undone.')) {
      return;
    }
    setSavedBusyId(id);
    setSavedError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-saved-idea', id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'delete failed');
      setSavedIdeas((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      setSavedError(e?.message ?? 'delete failed');
    } finally {
      setSavedBusyId(null);
    }
  }

  // ── Step 147: draft wagers ────────────────────────────────────────────────

  // ── Step 155: idea feedback + tuning summary ─────────────────────────────

  function buildFeedbackSnapshot(idea: WeatherMarketIdea): {
    ideaSummary: any;
    ideaFingerprint?: string;
    metricPair: string;
    weatherTags?: WeatherPersonalityTag[];
    tagMode?: TagMode;
    targetDifferenceF?: number;
    toleranceF?: number;
    cityUniverse: string;
    region?: string;
    presetId?: string;
  } {
    return {
      ideaSummary: {
        title: idea.title,
        locationAName: idea.locationA?.label ?? 'A',
        locationBName: idea.locationB?.label ?? 'B',
        metricA: idea.metricA,
        metricB: idea.metricB,
        rawDifference: idea.rawDifference,
        suggestedSpread: idea.suggestedSpread,
      },
      // Fingerprint mirrors the saved-idea / draft fingerprint scheme
      // (Step 146): targetDate|locA|locB|metricA|metricB|spread.
      ideaFingerprint: [
        idea.targetDate,
        idea.locationA?.id ?? '',
        idea.locationB?.id ?? '',
        idea.metricA,
        idea.metricB,
        idea.suggestedSpread,
      ].join('|'),
      metricPair,
      weatherTags: result?.resolved.weatherTags,
      tagMode: result?.resolved.tagMode,
      targetDifferenceF: result?.resolved.targetDifferenceF,
      toleranceF: result?.resolved.toleranceF,
      cityUniverse: result?.resolved.cityUniverse ?? cityUniverse,
      region: result?.resolved.region,
      presetId: activePresetId || undefined,
    };
  }

  async function postFeedback(idea: WeatherMarketIdea, rating: FeedbackRating, reason?: FeedbackReason, note?: string) {
    setFeedbackError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit-idea-feedback',
          ideaId: idea.id,
          rating,
          reason,
          operatorNote: note,
          ...buildFeedbackSnapshot(idea),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'submit failed');
      setSubmittedFeedback((prev) => ({ ...prev, [idea.id]: { rating, reason } }));
    } catch (e: any) {
      setFeedbackError(e?.message ?? 'submit failed');
    }
  }

  function onClickUseful(idea: WeatherMarketIdea) {
    void postFeedback(idea, 'useful', 'good_candidate');
  }

  function onClickNeutral(idea: WeatherMarketIdea) {
    void postFeedback(idea, 'neutral');
  }

  function onClickNotUseful(idea: WeatherMarketIdea) {
    setPendingNotUsefulIdeaId(idea.id);
    setPendingReason('too_boring');
    setPendingNote('');
  }

  function onConfirmNotUseful(idea: WeatherMarketIdea) {
    void postFeedback(idea, 'not_useful', pendingReason, pendingNote);
    setPendingNotUsefulIdeaId(null);
    setPendingNote('');
  }

  function onCancelNotUseful() {
    setPendingNotUsefulIdeaId(null);
    setPendingNote('');
  }

  async function loadFeedbackSummary() {
    setFeedbackSummaryLoading(true);
    setFeedbackError(null);
    try {
      const r = await fetch(`${API}?action=get-feedback-summary`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setFeedbackSummary(j.summary ?? null);
    } catch (e: any) {
      setFeedbackError(e?.message ?? 'load failed');
    } finally {
      setFeedbackSummaryLoading(false);
    }
  }

  // ── Step 154: weather-personality tags + smart-discovery presets ─────────

  function toggleTag(tag: WeatherPersonalityTag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
    setActivePresetId(''); // any manual edit clears the preset attribution
  }

  function clearTags() {
    setSelectedTags([]);
    setActivePresetId('');
  }

  /**
   * Apply a preset's defaults to the controls. Tags + tagMode + region
   * + cityIds + metricPair + targetDifferenceF + toleranceF + dayOffset
   * are all set from the preset. We deliberately switch the operator
   * into expanded mode if they weren't already — presets only target
   * the curated universe.
   */
  function applyPreset(presetId: string) {
    if (!presetId) {
      setActivePresetId('');
      return;
    }
    const preset = smartPresets.find((p) => p.id === presetId);
    if (!preset) return;
    setActivePresetId(preset.id);
    setCityUniverse('expanded_us');
    if (preset.region) {
      setRegionFilter(preset.region as CityRegionFilter);
    } else {
      setRegionFilter('all_expanded');
    }
    if (Array.isArray(preset.cityIds) && preset.cityIds.length > 0) {
      // Only seed cities the operator's catalog actually contains.
      const known = new Set(expandedCities.map((c) => c.id));
      setSelectedExpandedCityIds(preset.cityIds.filter((id) => known.has(id)));
    } else {
      setSelectedExpandedCityIds([]);
    }
    setSelectedTags(preset.tags ? [...preset.tags] : []);
    setTagMode(preset.tagMode ?? 'any');
    if (preset.metricPair) setMetricPair(preset.metricPair);
    if (typeof preset.targetDifferenceF === 'number') {
      setUseTargetDifference(true);
      setTargetDifferenceF(String(preset.targetDifferenceF));
      setToleranceF(String(preset.toleranceF ?? 5));
    } else {
      setUseTargetDifference(false);
    }
    if (typeof preset.dayOffset === 'number') {
      setTargetDate(defaultTargetDate(preset.dayOffset));
    }
  }

  // ── Step 153: searchable picker + favorite city sets ────────────────────

  async function loadCitySets() {
    setCitySetsLoading(true);
    setCitySetsError(null);
    try {
      const r = await fetch(`${API}?action=list-city-sets`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setCitySets(j.citySets ?? []);
    } catch (e: any) {
      setCitySetsError(e?.message ?? 'load failed');
    } finally {
      setCitySetsLoading(false);
    }
  }

  // Eager-load city sets on first entry to expanded mode so the panel
  // is populated when the operator switches to it.
  useEffect(() => {
    if (cityUniverse !== 'expanded_us') return;
    if (citySets.length > 0 || citySetsLoading) return;
    void loadCitySets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityUniverse]);

  function addCityToSelection(id: string) {
    setSelectedExpandedCityIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeCityFromSelection(id: string) {
    setSelectedExpandedCityIds((prev) => prev.filter((x) => x !== id));
  }

  function clearCitySelection() {
    setSelectedExpandedCityIds([]);
  }

  function selectVisibleCities(ids: string[]) {
    setSelectedExpandedCityIds((prev) => {
      const merged = new Set(prev);
      for (const id of ids) merged.add(id);
      return Array.from(merged);
    });
  }

  function parseTagsInput(s: string): string[] {
    return s
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  async function onSaveCurrentAsCitySet() {
    setCitySetFlash(null);
    setCitySetsError(null);
    if (!newSetName.trim()) {
      setCitySetFlash({ kind: 'err', msg: 'Set name required.' });
      return;
    }
    if (selectedExpandedCityIds.length === 0) {
      setCitySetFlash({ kind: 'err', msg: 'Select at least one city before saving.' });
      return;
    }
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-city-set',
          name: newSetName,
          cityIds: selectedExpandedCityIds,
          note: newSetNote || undefined,
          tags: parseTagsInput(newSetTagsInput),
          upsert: newSetUpsert,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setCitySetFlash({ kind: 'err', msg: j.message ?? j.error ?? 'save failed' });
        return;
      }
      setCitySetFlash({
        kind: 'ok',
        msg: j.upserted
          ? `Updated set "${j.citySet?.name}".`
          : (j.isDuplicate
              ? `Set "${j.citySet?.name}" already exists (id ${j.existingId}). Re-check the name or use upsert.`
              : `Saved set "${j.citySet?.name}" (${j.citySet?.cityCount} cities).`),
      });
      setNewSetName('');
      setNewSetNote('');
      setNewSetTagsInput('');
      setNewSetUpsert(false);
      void loadCitySets();
    } catch (e: any) {
      setCitySetFlash({ kind: 'err', msg: e?.message ?? 'save failed' });
    }
  }

  function onLoadCitySet(set: WeatherMarketCitySet) {
    // Replace the current selection. Cities not in the catalog are
    // silently dropped — the server validates at write time, but a
    // stale id (city removed from the universe later) shouldn't crash.
    const known = new Set(expandedCities.map((c) => c.id));
    const survivors = set.cityIds.filter((id) => known.has(id));
    setSelectedExpandedCityIds(survivors);
    const dropped = set.cityIds.length - survivors.length;
    setCitySetFlash({
      kind: 'ok',
      msg: dropped > 0
        ? `Loaded "${set.name}" — ${survivors.length} cities (${dropped} stale id(s) dropped).`
        : `Loaded "${set.name}" — ${survivors.length} cities.`,
    });
  }

  async function onDeleteCitySet(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this favorite city set? This cannot be undone.')) {
      return;
    }
    setCitySetBusyId(id);
    setCitySetsError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-city-set', id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'delete failed');
      setCitySets((prev) => prev.filter((s) => s.id !== id));
    } catch (e: any) {
      setCitySetsError(e?.message ?? 'delete failed');
    } finally {
      setCitySetBusyId(null);
    }
  }

  async function loadDraftWagers() {
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const r = await fetch(`${API}?action=list-draft-wagers&limit=200`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setDraftWagers(j.draftWagers ?? []);
      setDraftRiskMap(j.riskWarnings ?? {});
    } catch (e: any) {
      setDraftsError(e?.message ?? 'load failed');
    } finally {
      setDraftsLoading(false);
    }
  }

  // Auto-refresh whenever the operator opens the Drafts tab so a draft
  // they just created from the Saved Ideas tab shows up immediately.
  useEffect(() => {
    if (tab !== 'drafts') return;
    loadDraftWagers();
  }, [tab]);

  // Step 151 — entry point: pop the high-severity modal first if any
  // applies, otherwise proceed to the Step 147 draft-create modal as
  // before. Operator decides on every screen — nothing is auto-blocked.
  function onClickCreateDraft(saved: SavedWeatherMarketIdea) {
    const highs = highSeverityWarnings(savedRiskMap[saved.id]);
    if (highs.length === 0) {
      openDraftConfirm(saved);
      return;
    }
    setHighSevConfirm({
      actionLabel: 'Create draft wager',
      candidateTitle: saved.idea.title,
      warnings: highs,
      onConfirm: () => {
        setHighSevConfirm(null);
        // Stash the override on the saved record so the existing modal's
        // confirm path can pass it along when it calls the action.
        setPendingDraftRiskOverride({ savedIdeaId: saved.id, override: buildRiskOverride(highs) });
        openDraftConfirm(saved);
      },
    });
  }

  function openDraftConfirm(saved: SavedWeatherMarketIdea) {
    setDraftConfirm(saved);
  }

  function closeDraftConfirm() {
    setDraftConfirm(null);
  }

  async function onCreateDraftFromIdea(saved: SavedWeatherMarketIdea) {
    setSavedBusyId(saved.id);
    setSavedError(null);
    setDraftFlash(null);
    // If the operator went through the Step 151 high-severity modal for
    // this saved idea, pull the override off the staging slot and clear
    // it so the next click starts fresh.
    const stagedOverride = pendingDraftRiskOverride?.savedIdeaId === saved.id
      ? pendingDraftRiskOverride.override
      : undefined;
    setPendingDraftRiskOverride(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-draft-wager-from-idea',
          savedIdeaId: saved.id,
          ...(stagedOverride ? { riskOverride: stagedOverride } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = j.message ?? j.error ?? 'create draft failed';
        setDraftFlash({ savedIdeaId: saved.id, error: msg, existingDraftId: j.existingDraftId });
        return;
      }
      // Patch the saved idea in the list (server marks it 'used').
      if (j.savedIdea) {
        setSavedIdeas((prev) => prev.map((s) => (s.id === j.savedIdea.id ? j.savedIdea : s)));
      }
      setDraftFlash({ savedIdeaId: saved.id, draftId: j.draftWager?.id });
      // If the operator is browsing the Drafts tab, refresh it.
      if (tab === 'drafts') void loadDraftWagers();
    } catch (e: any) {
      setDraftFlash({ savedIdeaId: saved.id, error: e?.message ?? 'create draft failed' });
    } finally {
      setSavedBusyId(null);
      closeDraftConfirm();
    }
  }

  async function onDeleteDraft(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this draft wager? It is not published — this only removes the saved draft from Redis.')) {
      return;
    }
    setDraftBusyId(id);
    setDraftsError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-draft-wager', id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'delete failed');
      setDraftWagers((prev) => prev.filter((d) => d.id !== id));
    } catch (e: any) {
      setDraftsError(e?.message ?? 'delete failed');
    } finally {
      setDraftBusyId(null);
    }
  }

  // ── Step 148: publish a draft into the live wager store ──────────────────

  function openPublishConfirm(d: DraftWager) {
    setPublishConfirm(d);
  }
  function closePublishConfirm() {
    setPublishConfirm(null);
  }

  // ── Step 149: QA tab ──────────────────────────────────────────────────────

  async function loadMarketQA(filter: MarketQAStatus | 'all') {
    setQaLoading(true);
    setQaError(null);
    try {
      const url = filter === 'all'
        ? `${API}?action=list-market-qa&limit=200`
        : `${API}?action=list-market-qa&status=${encodeURIComponent(filter)}&limit=200`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'load failed');
      setQaList(j.qaRecords ?? []);
      setQaRiskMap(j.riskWarnings ?? {});
    } catch (e: any) {
      setQaError(e?.message ?? 'load failed');
    } finally {
      setQaLoading(false);
    }
  }

  // Refresh on tab open / filter change.
  useEffect(() => {
    if (tab !== 'qa') return;
    loadMarketQA(qaFilter);
  }, [tab, qaFilter]);

  function getEffectiveChecklist(qa: MarketQA): MarketQAChecklist {
    return qaChecklistDrafts[qa.id] ?? qa.checklist ?? emptyChecklist();
  }

  function setChecklistDraft(qa: MarketQA, key: keyof MarketQAChecklist, value: boolean) {
    setQaChecklistDrafts((prev) => {
      const current = prev[qa.id] ?? qa.checklist ?? emptyChecklist();
      return { ...prev, [qa.id]: { ...current, [key]: value } };
    });
  }

  async function onSaveQAChecklist(qa: MarketQA) {
    const checklist = getEffectiveChecklist(qa);
    const note = qaNoteDrafts[qa.id] ?? qa.operatorNote ?? '';
    setQaBusyId(qa.id);
    setQaError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-market-qa',
          id: qa.id,
          checklist,
          operatorNote: note,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'save failed');
      setQaList((prev) => prev.map((x) => (x.id === qa.id ? j.qa : x)));
      // Drop drafts now that they're persisted.
      setQaChecklistDrafts((prev) => {
        const next = { ...prev };
        delete next[qa.id];
        return next;
      });
      setQaNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[qa.id];
        return next;
      });
    } catch (e: any) {
      setQaError(e?.message ?? 'save failed');
    } finally {
      setQaBusyId(null);
    }
  }

  async function performUpdateQAStatus(qa: MarketQA, status: MarketQAStatus, riskOverride?: RiskOverridePayload) {
    setQaBusyId(qa.id);
    setQaError(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-market-qa-status',
          id: qa.id,
          status,
          ...(riskOverride ? { riskOverride } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? j.error ?? 'status update failed');
      setQaList((prev) => prev.map((x) => (x.id === qa.id ? j.qa : x)));
    } catch (e: any) {
      setQaError(e?.message ?? 'status update failed');
    } finally {
      setQaBusyId(null);
    }
  }

  function onUpdateQAStatus(qa: MarketQA, status: MarketQAStatus) {
    // Step 151 — only the `passed` transition warrants a soft confirm
    // when high-severity warnings are present. needs_changes / rejected
    // are inherently more cautious; pending is a revert. Modal would be
    // distracting in those cases.
    if (status !== 'passed') {
      void performUpdateQAStatus(qa, status);
      return;
    }
    const highs = highSeverityWarnings(qaRiskMap[qa.id]);
    if (highs.length === 0) {
      void performUpdateQAStatus(qa, status);
      return;
    }
    setHighSevConfirm({
      actionLabel: 'Mark QA passed',
      candidateTitle: qa.snapshot.title,
      warnings: highs,
      onConfirm: () => {
        setHighSevConfirm(null);
        void performUpdateQAStatus(qa, status, buildRiskOverride(highs));
      },
    });
  }

  async function onPublishDraft(d: DraftWager) {
    setDraftBusyId(d.id);
    setDraftsError(null);
    setPublishFlash(null);
    // Step 151 — pick up the staged risk-override metadata if the
    // operator went through the high-severity confirmation modal for
    // this draft. Cleared so the next click starts fresh.
    const stagedOverride = pendingPublishRiskOverride?.draftId === d.id
      ? pendingPublishRiskOverride.override
      : undefined;
    setPendingPublishRiskOverride(null);
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish-draft-wager',
          id: d.id,
          ...(stagedOverride ? { riskOverride: stagedOverride } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setPublishFlash({
          draftId: d.id,
          error: j.message ?? j.error ?? 'publish failed',
          existingWagerId: j.publishedWagerId,
        });
        return;
      }
      // Patch the draft in the list with the new published state.
      if (j.draftWager) {
        setDraftWagers((prev) => prev.map((x) => (x.id === j.draftWager.id ? j.draftWager : x)));
      }
      setPublishFlash({
        draftId: d.id,
        publishedWagerId: j.wager?.id,
        publishedTitle: j.wager?.title,
        warning: j.warning,
        qaId: j.qa?.id,
      });
    } catch (e: any) {
      setPublishFlash({ draftId: d.id, error: e?.message ?? 'publish failed' });
    } finally {
      setDraftBusyId(null);
      closePublishConfirm();
    }
  }

  function onCopy(field: string, text: string) {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  function toggleCity(id: string) {
    setSelectedCityIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function selectAll() {
    const all: Record<string, boolean> = {};
    for (const c of seedCities) all[c.id] = true;
    setSelectedCityIds(all);
  }

  function selectNone() {
    setSelectedCityIds({});
  }

  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', padding: 16, color: '#e2e8f0' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Weather Market Ideas</h1>

      <div style={BANNER}>
        <span>
          <strong>Saved ideas are not markets.</strong> Nothing is live until an admin manually creates and publishes a wager. Saving, marking reviewed/used, or following the prefilled link does not write to the wager / pricing / settlement / wallet stores.
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>ADMIN · IDEA-ONLY</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabBtn(tab === 'generate')} onClick={() => setTab('generate')}>
          Generate
        </button>
        <button style={tabBtn(tab === 'saved')} onClick={() => setTab('saved')}>
          Saved Ideas
        </button>
        <button style={tabBtn(tab === 'drafts')} onClick={() => setTab('drafts')}>
          Draft Wagers
        </button>
        <button style={tabBtn(tab === 'qa')} onClick={() => setTab('qa')}>
          Post-Publish QA
        </button>
      </div>

      {error && (
        <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {tab === 'generate' && (
        <>
          <div style={card}>
            <h2 style={sectionHeader}>Generate ideas</h2>

            <div style={{ ...muted, marginBottom: 8 }}>
              {useTargetDifference
                ? `Find forecasted temperature differences near ${targetDifferenceF || '?'}°F (±${toleranceF || '?'}°F).`
                : 'Show the most interesting forecasted temperature spreads (legacy mode — |Δ| ≥ 8°F, ranked by interestingness).'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 920 }}>
              <div>
                <span style={labelStyle}>Target date (YYYY-MM-DD)</span>
                <input
                  style={{ ...input, width: '100%' }}
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  placeholder={defaultTargetDate(1)}
                />
              </div>
              <div>
                <span style={labelStyle}>Quick offsets</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      style={{ ...btn(targetDate === defaultTargetDate(n) ? '#0e7490' : '#334155'), opacity: 0.9 }}
                      onClick={() => setTargetDate(defaultTargetDate(n))}
                    >
                      +{n}d
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span style={labelStyle}>Metric pair</span>
                <select
                  style={{ ...input, width: '100%' }}
                  value={metricPair}
                  onChange={(e) => setMetricPair(e.target.value as MetricPairOption)}
                >
                  {metricPairOptions.map((opt) => (
                    <option key={opt} value={opt}>{METRIC_PAIR_LABELS[opt] ?? opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <span style={labelStyle}>Max results (1–{limits.maxResultsCap})</span>
                <input
                  style={{ ...input, width: '100%' }}
                  value={maxResults}
                  onChange={(e) => setMaxResults(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={useTargetDifference}
                  onChange={(e) => setUseTargetDifference(e.target.checked)}
                />
                Search by target temperature difference
              </label>
              {useTargetDifference && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, maxWidth: 720 }}>
                  <div>
                    <span style={labelStyle}>Find forecasted temperature differences near ___ °F (0–{limits.targetDifferenceFMax})</span>
                    <input
                      style={{ ...input, width: '100%' }}
                      value={targetDifferenceF}
                      onChange={(e) => setTargetDifferenceF(e.target.value)}
                      inputMode="numeric"
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <span style={labelStyle}>Tolerance ± °F (0–{limits.toleranceFMax})</span>
                    <input
                      style={{ ...input, width: '100%' }}
                      value={toleranceF}
                      onChange={(e) => setToleranceF(e.target.value)}
                      inputMode="numeric"
                      placeholder="3"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Step 152 — bounded city universe selector. */}
            <div style={{ marginTop: 12, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <span style={labelStyle}>City universe</span>
                  <select
                    style={{ ...input, width: '100%' }}
                    value={cityUniverse}
                    onChange={(e) => setCityUniverse(e.target.value as CityUniverseMode)}
                  >
                    {cityUniverseOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {CITY_UNIVERSE_LABELS[opt] ?? opt}
                        {opt === 'expanded_us' && expandedUsCityCount ? ` (${expandedUsCityCount})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {cityUniverse === 'expanded_us' && (
                  <>
                    <div>
                      <span style={labelStyle}>Region filter</span>
                      <select
                        style={{ ...input, width: '100%' }}
                        value={regionFilter}
                        onChange={(e) => setRegionFilter(e.target.value as CityRegionFilter)}
                      >
                        {regionOptions.map((opt) => {
                          const count = expandedRegionCounts[opt];
                          return (
                            <option key={opt} value={opt}>
                              {CITY_REGION_LABELS[opt] ?? opt}
                              {typeof count === 'number' ? ` (${count})` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <span style={labelStyle}>
                        Max candidate cities (1–{limits.maxCandidateCitiesCap ?? 100})
                      </span>
                      <input
                        style={{ ...input, width: '100%' }}
                        value={maxCandidateCities}
                        onChange={(e) => setMaxCandidateCities(e.target.value)}
                        inputMode="numeric"
                      />
                    </div>
                  </>
                )}
              </div>
              {cityUniverse === 'expanded_us' && (
                <div style={{ ...muted, marginTop: 8, color: '#fbbf24' }}>
                  Expanded scans are bounded and admin-only. Cap is {limits.maxCandidateCitiesCap ?? 100} cities; default {limits.defaultExpandedCandidateCities ?? 75}. Generation may take longer because each candidate city triggers one forecast fetch. Selected cities are drawn only from the approved city universe — no arbitrary locations are scanned.
                </div>
              )}
            </div>

            {/* Step 154 — smart-discovery presets + weather-personality tag filter.
                Visible only in expanded mode. Sits above the picker so the
                workflow reads top-down: choose preset (or pick tags) →
                refine cities → generate. */}
            {cityUniverse === 'expanded_us' && (
              <div style={{ marginTop: 12, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: '#e2e8f0' }}>Smart discovery</strong>
                  <span style={muted}>
                    Presets pre-fill tags + metric pair + target difference + day offset. You can still edit any field after.
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 6 }}>
                  <select
                    style={{ ...input, width: '100%' }}
                    value={activePresetId}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    <option value="">— Pick a smart-discovery preset —</option>
                    {smartPresets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {activePresetId && (() => {
                    const p = smartPresets.find((x) => x.id === activePresetId);
                    if (!p) return null;
                    return (
                      <div style={{ ...muted, fontSize: 11 }}>
                        <strong style={{ color: '#cbd5e1' }}>{p.label}:</strong> {p.description}
                      </div>
                    );
                  })()}
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13, color: '#e2e8f0' }}>Weather personality tags</strong>
                  <span style={muted}>
                    {selectedTags.length} selected · mode:
                  </span>
                  <select
                    style={{ ...input }}
                    value={tagMode}
                    onChange={(e) => { setTagMode(e.target.value as TagMode); setActivePresetId(''); }}
                  >
                    {tagModeOptions.map((m) => (
                      <option key={m} value={m}>{m === 'all' ? 'all (must match every tag)' : 'any (match at least one)'}</option>
                    ))}
                  </select>
                  {selectedTags.length > 0 && (
                    <button style={btn('#475569')} onClick={clearTags}>Clear tags</button>
                  )}
                  {selectedExpandedCityIds.length > 0 && selectedTags.length > 0 && (
                    <span style={{ ...muted, color: '#fbbf24' }}>
                      Active city selection overrides tags for this run.
                    </span>
                  )}
                </div>

                <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {weatherPersonalityTags.map((t) => {
                    const isOn = selectedTags.includes(t);
                    const count = tagCounts[t] ?? 0;
                    return (
                      <button
                        key={t}
                        onClick={() => toggleTag(t)}
                        style={{
                          background: isOn ? '#0e7490' : '#1e293b',
                          color: '#e2e8f0',
                          border: '1px solid #334155',
                          borderRadius: 999,
                          padding: '4px 10px',
                          fontSize: 11,
                          cursor: 'pointer',
                        }}
                        title={`${TAG_LABELS[t] ?? t} — ${count} cities`}
                      >
                        {isOn ? '✓ ' : ''}{TAG_LABELS[t] ?? t}
                        <span style={{ color: '#94a3b8', marginLeft: 4 }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ ...muted, marginTop: 8, fontSize: 11 }}>
                  Tags filter the approved city universe. They do not scan arbitrary locations.
                </div>

                {/* Step 155 — preset tuning summary. Advisory only —
                    presets stay in code; this just helps you see what's
                    working over time. */}
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #334155' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <strong style={{ fontSize: 13, color: '#e2e8f0' }}>Preset tuning notes</strong>
                    <span style={muted}>Advisory only — preset edits stay manual.</span>
                    <button
                      style={{ ...btn('#475569'), marginLeft: 'auto' }}
                      onClick={loadFeedbackSummary}
                    >
                      {feedbackSummaryLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  {feedbackError && (
                    <div style={{ background: '#7f1d1d', color: '#fef2f2', padding: '6px 8px', borderRadius: 6, fontSize: 11, marginBottom: 6 }}>
                      <strong>Error:</strong> {feedbackError}
                    </div>
                  )}
                  {!feedbackSummary ? (
                    <div style={muted}>
                      Click Refresh to load the latest feedback summary.
                    </div>
                  ) : feedbackSummary.totalFeedback === 0 ? (
                    <div style={muted}>
                      No feedback recorded yet. Mark generated ideas Useful / Not useful to start the tuning trail.
                    </div>
                  ) : (
                    <>
                      <ul style={{ ...muted, fontSize: 11, paddingLeft: 16, marginTop: 0 }}>
                        {feedbackSummary.topLevelNotes.map((n, i) => (
                          <li key={i} style={{ color: '#cbd5e1' }}>{n}</li>
                        ))}
                      </ul>
                      {feedbackSummary.byPreset.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ ...muted, fontSize: 11, marginBottom: 4 }}>Per preset</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                            {feedbackSummary.byPreset.map((g) => (
                              <div
                                key={g.key}
                                style={{
                                  background: '#1e293b',
                                  border: '1px solid #334155',
                                  borderRadius: 6,
                                  padding: 8,
                                  fontSize: 11,
                                }}
                              >
                                <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{g.key}</div>
                                <div style={muted}>
                                  {g.totalCount} record(s) · {g.usefulCount}u / {g.notUsefulCount}nu / {g.neutralCount}n
                                  {g.usefulRate !== null && (
                                    <> · {Math.round(g.usefulRate * 100)}% useful</>
                                  )}
                                </div>
                                {g.topNegativeReasons.length > 0 && (
                                  <div style={{ ...muted, marginTop: 2 }}>
                                    Top negatives: {g.topNegativeReasons.map((r) => `${FEEDBACK_REASON_LABELS[r.reason] ?? r.reason} (${r.count})`).join(', ')}
                                  </div>
                                )}
                                <div style={{ marginTop: 4, color: '#cbd5e1' }}>{g.tuningNote}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {feedbackSummary.byTag.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ ...muted, fontSize: 11, marginBottom: 4 }}>Per tag</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {feedbackSummary.byTag.slice(0, 12).map((g) => (
                              <span
                                key={g.key}
                                style={{
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  borderRadius: 999,
                                  padding: '2px 8px',
                                  fontSize: 10,
                                  color: '#cbd5e1',
                                }}
                                title={g.tuningNote}
                              >
                                {g.key}: {g.usefulRate !== null ? `${Math.round(g.usefulRate * 100)}% useful` : '—'} ({g.totalCount})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Step 153 — searchable city picker + favorite-set panel.
                Visible only in expanded mode. */}
            {cityUniverse === 'expanded_us' && (
              <div style={{ marginTop: 12, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: '#e2e8f0' }}>City picker</strong>
                  <span style={muted}>
                    {selectedExpandedCityIds.length} selected of {expandedCities.length} (cap {limits.maxCityIdsPerSet ?? 100})
                  </span>
                  {selectedExpandedCityIds.length > 0 && (
                    <button style={btn('#475569')} onClick={clearCitySelection}>
                      Clear selection
                    </button>
                  )}
                  {selectedExpandedCityIds.length > 0 && (
                    <span style={{ ...muted, color: '#22c55e' }}>
                      Active selection overrides the region filter for the next Generate.
                    </span>
                  )}
                </div>

                {(() => {
                  const q = pickerSearch.trim().toLowerCase();
                  const matches = q.length === 0
                    ? expandedCities
                    : expandedCities.filter(
                        (c) =>
                          c.label.toLowerCase().includes(q) ||
                          c.city.toLowerCase().includes(q) ||
                          c.state.toLowerCase().includes(q) ||
                          c.region.toLowerCase().includes(q),
                      );
                  const visibleIds = matches.map((c) => c.id);
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                        <input
                          style={{ ...input, flex: '1 1 240px', minWidth: 200 }}
                          placeholder="Search city, state, or region…"
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                        />
                        <button
                          style={btn('#475569')}
                          onClick={() => selectVisibleCities(visibleIds)}
                          disabled={visibleIds.length === 0}
                          title="Add every city currently matching the search to the selection."
                        >
                          Select all visible ({matches.length})
                        </button>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                          gap: 4,
                          maxHeight: 220,
                          overflowY: 'auto',
                          padding: 6,
                          background: '#020617',
                          border: '1px solid #1e293b',
                          borderRadius: 6,
                        }}
                      >
                        {matches.length === 0 ? (
                          <div style={{ ...muted, gridColumn: '1 / -1' }}>No cities match.</div>
                        ) : (
                          matches.slice(0, 200).map((c) => {
                            const isSelected = selectedExpandedCityIds.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                onClick={() => (isSelected ? removeCityFromSelection(c.id) : addCityToSelection(c.id))}
                                style={{
                                  background: isSelected ? '#15803d' : '#1e293b',
                                  color: '#e2e8f0',
                                  border: '1px solid #334155',
                                  borderRadius: 4,
                                  padding: '4px 6px',
                                  fontSize: 11,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                                title={`${c.label} (${c.region})`}
                              >
                                {isSelected ? '✓ ' : ''}{c.label}
                                <span style={{ color: '#94a3b8', marginLeft: 4 }}>· {c.region}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                      {matches.length > 200 && (
                        <div style={{ ...muted, marginTop: 4 }}>
                          Showing first 200 of {matches.length} matches — refine search to narrow.
                        </div>
                      )}
                    </>
                  );
                })()}

                {selectedExpandedCityIds.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{ ...muted, marginBottom: 4, display: 'block' }}>
                      Selected cities (click × to remove)
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {selectedExpandedCityIds.map((id) => {
                        const c = expandedCities.find((x) => x.id === id);
                        return (
                          <span
                            key={id}
                            style={{
                              background: '#0e7490',
                              color: '#fff',
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            {c?.label ?? id}
                            <button
                              onClick={() => removeCityFromSelection(id)}
                              style={{
                                background: 'transparent',
                                color: '#fff',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: 13,
                                lineHeight: 1,
                              }}
                              title={`Remove ${c?.label ?? id}`}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Favorite city sets */}
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed #334155' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <strong style={{ fontSize: 13, color: '#e2e8f0' }}>Favorite city sets</strong>
                    <span style={muted}>
                      {citySets.length} of {limits.citySetsCap ?? 100} saved
                    </span>
                    <button
                      style={{ ...btn('#475569'), marginLeft: 'auto' }}
                      onClick={() => loadCitySets()}
                    >
                      Refresh
                    </button>
                  </div>

                  {citySetsError && (
                    <div style={{ background: '#7f1d1d', color: '#fef2f2', padding: '6px 8px', borderRadius: 6, fontSize: 11, marginBottom: 6 }}>
                      <strong>Error:</strong> {citySetsError}
                    </div>
                  )}

                  {citySetsLoading ? (
                    <div style={muted}>Loading saved sets…</div>
                  ) : citySets.length === 0 ? (
                    <div style={muted}>
                      No favorite sets saved yet. Pick cities above, give the set a name, and save.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                      {citySets.map((s) => {
                        const isBusy = citySetBusyId === s.id;
                        return (
                          <div
                            key={s.id}
                            style={{
                              background: '#1e293b',
                              border: '1px solid #334155',
                              borderRadius: 6,
                              padding: 8,
                              fontSize: 11,
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{s.name}</div>
                            <div style={muted}>
                              {s.cityCount} cit{s.cityCount === 1 ? 'y' : 'ies'}
                              {s.tags && s.tags.length > 0 && (
                                <> · {s.tags.join(', ')}</>
                              )}
                            </div>
                            {s.note && (
                              <div style={{ ...muted, fontStyle: 'italic', marginTop: 2 }}>{s.note}</div>
                            )}
                            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button
                                style={{ ...btn('#0e7490'), opacity: isBusy ? 0.6 : 1 }}
                                disabled={isBusy}
                                onClick={() => onLoadCitySet(s)}
                              >
                                Load
                              </button>
                              <button
                                style={{ ...btn('#7f1d1d'), opacity: isBusy ? 0.6 : 1 }}
                                disabled={isBusy}
                                onClick={() => onDeleteCitySet(s.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Inline save form. Hidden when nothing is selected. */}
                  {selectedExpandedCityIds.length > 0 && (
                    <div style={{ marginTop: 12, padding: 8, background: '#020617', borderRadius: 6 }}>
                      <div style={{ ...muted, marginBottom: 6 }}>
                        Save current {selectedExpandedCityIds.length}-city selection as a favorite:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
                        <input
                          style={{ ...input, width: '100%' }}
                          placeholder={`Set name (≤${limits.citySetNameMaxLen ?? 80} chars)`}
                          value={newSetName}
                          onChange={(e) => setNewSetName(e.target.value)}
                          maxLength={limits.citySetNameMaxLen ?? 80}
                        />
                        <input
                          style={{ ...input, width: '100%' }}
                          placeholder="Tags (comma-separated, ≤8)"
                          value={newSetTagsInput}
                          onChange={(e) => setNewSetTagsInput(e.target.value)}
                        />
                      </div>
                      <textarea
                        style={{ ...textareaStyle, width: '100%', marginTop: 6 }}
                        placeholder={`Optional note (≤${limits.citySetNoteMaxLen ?? 500} chars)`}
                        value={newSetNote}
                        onChange={(e) => setNewSetNote(e.target.value)}
                        maxLength={limits.citySetNoteMaxLen ?? 500}
                      />
                      <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#cbd5e1' }}>
                          <input
                            type="checkbox"
                            checked={newSetUpsert}
                            onChange={(e) => setNewSetUpsert(e.target.checked)}
                          />
                          Update existing if name matches
                        </label>
                        <button
                          style={btn('#15803d')}
                          onClick={onSaveCurrentAsCitySet}
                        >
                          Save as favorite
                        </button>
                        {citySetFlash && (
                          <span
                            style={{
                              fontSize: 11,
                              color: citySetFlash.kind === 'ok' ? '#22c55e' : '#fca5a5',
                            }}
                          >
                            {citySetFlash.msg}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Seed-12 mode keeps the per-city checkbox grid (12 boxes is fine).
                Expanded mode hides it — region filter is the control there. */}
            {cityUniverse === 'seed_12' && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={muted}>Cities ({cityIdsToInclude.length} of {seedCities.length} selected):</span>
                  <button style={btn('#475569')} onClick={selectAll}>All</button>
                  <button style={btn('#475569')} onClick={selectNone}>None</button>
                </div>
                {loading ? (
                  <div style={muted}>Loading seed cities…</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
                    {seedCities.map((c) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={!!selectedCityIds[c.id]}
                          onChange={() => toggleCity(c.id)}
                        />
                        <span>{c.label}</span>
                        <span style={{ ...muted, fontSize: 10 }}>({c.region})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                style={{
                  ...btn('#0e7490'),
                  opacity:
                    busy || (cityUniverse === 'seed_12' && cityIdsToInclude.length < 2)
                      ? 0.6
                      : 1,
                }}
                disabled={busy || (cityUniverse === 'seed_12' && cityIdsToInclude.length < 2)}
                onClick={onGenerate}
              >
                {busy ? 'Generating…' : 'Generate ideas'}
              </button>
              {cityUniverse === 'seed_12' && cityIdsToInclude.length < 2 && (
                <span style={{ ...muted, marginLeft: 8 }}>Pick at least 2 cities.</span>
              )}
            </div>
          </div>

          {result && (
            <div style={card}>
              <h2 style={sectionHeader}>
                {result.ideas.length} draft idea{result.ideas.length === 1 ? '' : 's'} for {result.targetDate}
              </h2>
              <div style={muted}>
                Generated {new Date(result.generatedAt).toLocaleString()} ·{' '}
                universe: {CITY_UNIVERSE_LABELS[result.resolved.cityUniverse] ?? result.resolved.cityUniverse}
                {result.resolved.cityUniverse === 'expanded_us' && result.resolved.region && (
                  <> · region: {CITY_REGION_LABELS[result.resolved.region] ?? result.resolved.region}</>
                )}
                {' '}· {result.resolved.successfulForecastCount}/{result.resolved.candidateCityCount} cities forecasted
                {result.resolved.failedForecastCount > 0 && (
                  <> · <span style={{ color: '#fbbf24' }}>{result.resolved.failedForecastCount} forecast failure(s)</span></>
                )}
                {result.resolved.cityCountCappedTo !== undefined && (
                  <> · <span style={{ color: '#fbbf24' }}>capped at {result.resolved.cityCountCappedTo}</span></>
                )}
                {result.resolved.weatherTags && result.resolved.weatherTags.length > 0 && (
                  <> · tags: <span style={{ color: '#0ea5e9' }}>
                    [{result.resolved.weatherTags.map((t) => TAG_LABELS[t] ?? t).join(', ')}]
                  </span> ({result.resolved.tagMode ?? 'any'})
                  {result.resolved.tagFilteredCityCount !== undefined && (
                    <> → <span style={{ color: '#cbd5e1' }}>{result.resolved.tagFilteredCityCount} cities post-filter</span></>
                  )}
                  </>
                )}
                {' '}· metric pair: {METRIC_PAIR_LABELS[result.resolved.metricPair] ?? result.resolved.metricPair}
                {result.resolved.targetDifferenceF !== undefined && (
                  <> · target Δ {result.resolved.targetDifferenceF}°F ± {result.resolved.toleranceF ?? 3}°F</>
                )}
              </div>
              {result.warnings.length > 0 && (
                <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 12, paddingLeft: 16 }}>
                  {result.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                </ul>
              )}

              {/* Step 156 — sort selector + admin-only caveat. */}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={muted}>Sort:</span>
                <select
                  style={input}
                  value={ideaSortMode}
                  onChange={(e) => setIdeaSortMode(e.target.value as 'default' | 'closest' | 'interestingness')}
                >
                  <option value="default">Default ranking</option>
                  <option value="closest">Closest to target Δ</option>
                  <option value="interestingness">Highest interestingness</option>
                </select>
                <span style={{ ...muted, color: '#fbbf24' }}>
                  Admin-only idea ranking. Not betting advice.
                </span>
              </div>

              {result.ideas.length === 0 ? (
                <div style={{ ...muted, marginTop: 12 }}>
                  No ideas surfaced. Try a different date, more cities, a wider tolerance, or a different metric pair.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, marginTop: 12 }}>
                  {(() => {
                    const sorted = [...result.ideas];
                    if (ideaSortMode === 'closest') {
                      sorted.sort((a, b) => {
                        const ac = a.closenessToTarget ?? Infinity;
                        const bc = b.closenessToTarget ?? Infinity;
                        return ac - bc;
                      });
                    } else if (ideaSortMode === 'interestingness') {
                      sorted.sort((a, b) => {
                        const as = a.outcomeInterestingness?.score ?? -1;
                        const bs = b.outcomeInterestingness?.score ?? -1;
                        return bs - as;
                      });
                    }
                    return sorted;
                  })().map((idea) => (
                    <div key={idea.id} style={tile}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{idea.title}</div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: confidenceTone(idea.confidenceLabel),
                          }}
                          title={`Score ${idea.interestingnessScore.toFixed(1)}`}
                        >
                          {idea.confidenceLabel} confidence
                        </span>
                      </div>
                      <div style={{ ...muted, marginTop: 4 }}>{idea.rationale}</div>

                      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                        <div>
                          <div style={muted}>{idea.locationA.label} ({METRIC_LABELS[idea.metricA]})</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.forecastValueA}°F</div>
                        </div>
                        <div>
                          <div style={muted}>{idea.locationB.label} ({METRIC_LABELS[idea.metricB]})</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.forecastValueB}°F</div>
                        </div>
                        <div>
                          <div style={muted}>Raw difference (A − B)</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.rawDifference > 0 ? '+' : ''}{idea.rawDifference}°F</div>
                        </div>
                        <div>
                          <div style={muted}>Suggested spread (A side)</div>
                          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>
                            {idea.suggestedSpread >= 0 ? '+' : ''}{idea.suggestedSpread}°F
                          </div>
                        </div>
                        <div>
                          <div style={muted}>Default odds</div>
                          <div style={{ color: '#e2e8f0' }}>{idea.suggestedOddsA} / {idea.suggestedOddsB}</div>
                        </div>
                        {idea.closenessToTarget !== undefined && (
                          <div>
                            <div style={muted}>Closeness to target Δ</div>
                            <div style={{ color: '#e2e8f0' }}>{idea.closenessToTarget.toFixed(1)}°F off</div>
                          </div>
                        )}
                      </div>

                      {idea.warnings.length > 0 && (
                        <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 11, paddingLeft: 16 }}>
                          {idea.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                        </ul>
                      )}

                      {/* Step 156 — admin-only operator-interestingness rating. NOT betting advice. */}
                      {idea.outcomeInterestingness && (
                        <details
                          style={{
                            marginTop: 8,
                            background: '#0f172a',
                            border: `1px solid ${INTERESTINGNESS_TONE[idea.outcomeInterestingness.label]}`,
                            borderRadius: 6,
                            padding: '6px 8px',
                          }}
                        >
                          <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
                              Interestingness:
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: '#fff',
                                background: INTERESTINGNESS_TONE[idea.outcomeInterestingness.label],
                                padding: '2px 8px',
                                borderRadius: 999,
                                textTransform: 'uppercase',
                                letterSpacing: 0.3,
                              }}
                              title={`Score ${idea.outcomeInterestingness.score}/100 · sample ${idea.outcomeInterestingness.sampleCount}`}
                            >
                              {INTERESTINGNESS_LABEL_COPY[idea.outcomeInterestingness.label]} · {idea.outcomeInterestingness.score}/100
                            </span>
                            <span style={{ ...muted, fontSize: 10 }}>
                              n={idea.outcomeInterestingness.sampleCount} · expand for reasons
                            </span>
                          </summary>
                          <ul style={{ marginTop: 6, marginBottom: 4, color: '#cbd5e1', fontSize: 11, paddingLeft: 16 }}>
                            {idea.outcomeInterestingness.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                          <div style={{ ...muted, fontSize: 10, fontStyle: 'italic' }}>
                            Admin-only idea ranking. Not betting advice.
                          </div>
                        </details>
                      )}

                      {/* Step 150 — admin-only duplicate / correlation warnings. */}
                      <RiskBadges warnings={generateRiskMap[idea.id]} />

                      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          style={btn(copiedField === `${idea.id}-title` ? '#15803d' : '#475569')}
                          onClick={() => onCopy(`${idea.id}-title`, idea.title)}
                        >
                          {copiedField === `${idea.id}-title` ? 'Copied' : 'Copy title'}
                        </button>
                        <button
                          style={btn(copiedField === `${idea.id}-notes` ? '#15803d' : '#475569')}
                          onClick={() => onCopy(`${idea.id}-notes`, idea.setupNotes)}
                        >
                          {copiedField === `${idea.id}-notes` ? 'Copied' : 'Copy setup notes'}
                        </button>
                        {/* Step 146 — save to review queue. */}
                        <button
                          style={btn(saveFlash?.ideaId === idea.id ? (saveFlash.isDuplicate ? '#b45309' : '#15803d') : '#0ea5e9')}
                          onClick={() => onSaveGeneratedIdea(idea)}
                          title="Persist this idea to the admin review queue. Does not create or publish a wager."
                        >
                          {saveFlash?.ideaId === idea.id
                            ? (saveFlash.isDuplicate ? 'Already saved' : 'Saved ✓')
                            : 'Save idea'}
                        </button>
                        {/* Step 145 — assisted manual creation. */}
                        <a
                          style={link('#0e7490')}
                          href={`/admin/wagers?${idea.prefillQuery}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Opens the wager-create form pre-filled. You still have to click Create Wager."
                        >
                          Use this idea →
                        </a>
                      </div>

                      {/* Step 155 — compact feedback row. Operator-tracking only;
                          never publishes / saves / drafts. */}
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #334155' }}>
                        {submittedFeedback[idea.id] ? (
                          <div style={{ ...muted, fontSize: 11, color: '#22c55e' }}>
                            Feedback recorded:{' '}
                            <strong>{submittedFeedback[idea.id].rating}</strong>
                            {submittedFeedback[idea.id].reason && (
                              <> · {FEEDBACK_REASON_LABELS[submittedFeedback[idea.id].reason!]}</>
                            )}
                          </div>
                        ) : pendingNotUsefulIdeaId === idea.id ? (
                          <div style={{ background: '#020617', padding: 8, borderRadius: 6 }}>
                            <span style={{ ...muted, marginRight: 6 }}>Why not useful?</span>
                            <select
                              style={input}
                              value={pendingReason}
                              onChange={(e) => setPendingReason(e.target.value as FeedbackReason)}
                            >
                              {feedbackReasonsList
                                .filter((r) => r !== 'good_candidate')
                                .map((r) => (
                                  <option key={r} value={r}>{FEEDBACK_REASON_LABELS[r] ?? r}</option>
                                ))}
                            </select>
                            <input
                              style={{ ...input, marginLeft: 6, minWidth: 180 }}
                              placeholder="Optional note (≤500 chars)"
                              value={pendingNote}
                              onChange={(e) => setPendingNote(e.target.value)}
                              maxLength={500}
                            />
                            <button
                              style={{ ...btn('#7c3aed'), marginLeft: 6 }}
                              onClick={() => onConfirmNotUseful(idea)}
                            >
                              Submit
                            </button>
                            <button
                              style={{ ...btn('#475569'), marginLeft: 4 }}
                              onClick={onCancelNotUseful}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ ...muted, fontSize: 11, marginRight: 4 }}>Useful?</span>
                            <button
                              style={btn('#15803d')}
                              onClick={() => onClickUseful(idea)}
                              title="Mark this idea as a good candidate. Feedback only — no market action."
                            >
                              Useful
                            </button>
                            <button
                              style={btn('#7c3aed')}
                              onClick={() => onClickNotUseful(idea)}
                              title="Mark this idea as not useful and pick a reason. Feedback only — no market action."
                            >
                              Not useful
                            </button>
                            <button
                              style={btn('#475569')}
                              onClick={() => onClickNeutral(idea)}
                              title="Skip / neutral feedback. Counts toward the sample but doesn't push tuning either way."
                            >
                              Neutral
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'saved' && (
        <div style={card}>
          <h2 style={sectionHeader}>Saved idea queue</h2>
          <div style={{ ...muted, marginBottom: 8 }}>
            Up to {limits.savedIdeasCap} saved ideas. Saving, status changes, and notes are admin-only and never create or publish a wager.
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={muted}>Filter:</span>
            <button
              style={btn(savedFilter === 'all' ? '#0e7490' : '#334155')}
              onClick={() => setSavedFilter('all')}
            >
              All
            </button>
            {statusOptions.map((s) => (
              <button
                key={s}
                style={btn(savedFilter === s ? '#0e7490' : '#334155')}
                onClick={() => setSavedFilter(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
            <button
              style={{ ...btn('#475569'), marginLeft: 'auto' }}
              onClick={() => loadSavedIdeas(savedFilter)}
            >
              Refresh
            </button>
          </div>

          {savedError && (
            <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2', marginTop: 0 }}>
              <strong>Error:</strong> {savedError}
            </div>
          )}

          {savedLoading ? (
            <div style={muted}>Loading saved ideas…</div>
          ) : savedIdeas.length === 0 ? (
            <div style={muted}>
              {savedFilter === 'all' ? 'No saved ideas yet.' : `No saved ideas with status "${STATUS_LABELS[savedFilter as SavedIdeaStatus]}".`}
              {' '}Generate some on the Generate tab and click <strong>Save idea</strong>.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
              {savedIdeas.map((s) => {
                const i = s.idea;
                const draft = draftNotes[s.id];
                const hasDraft = draft !== undefined && draft !== (s.operatorNote ?? '');
                const isBusy = savedBusyId === s.id;
                return (
                  <div key={s.id} style={tile}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{i.title}</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: STATUS_TONES[s.status],
                          textTransform: 'uppercase',
                        }}
                      >
                        {STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>{i.rationale}</div>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                      <div>
                        <div style={muted}>{i.locationA.label} ({METRIC_LABELS[i.metricA]})</div>
                        <div>{i.forecastValueA}°F</div>
                      </div>
                      <div>
                        <div style={muted}>{i.locationB.label} ({METRIC_LABELS[i.metricB]})</div>
                        <div>{i.forecastValueB}°F</div>
                      </div>
                      <div>
                        <div style={muted}>Raw Δ (A − B)</div>
                        <div>{i.rawDifference > 0 ? '+' : ''}{i.rawDifference}°F</div>
                      </div>
                      <div>
                        <div style={muted}>Suggested spread</div>
                        <div style={{ fontWeight: 600 }}>
                          {i.suggestedSpread >= 0 ? '+' : ''}{i.suggestedSpread}°F
                        </div>
                      </div>
                    </div>

                    {s.warningFlags.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.warningFlags.map((f) => (
                          <span
                            key={f}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#fbbf24',
                              border: '1px solid #b45309',
                              padding: '2px 6px',
                              borderRadius: 999,
                              textTransform: 'uppercase',
                            }}
                          >
                            {f.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Step 150 — duplicate / correlation warnings against the universe. */}
                    <RiskBadges warnings={savedRiskMap[s.id]} />

                    <div style={{ marginTop: 10 }}>
                      <span style={labelStyle}>
                        Operator note (≤{limits.operatorNoteMaxLen} chars)
                      </span>
                      <textarea
                        style={{ ...textareaStyle, width: '100%' }}
                        value={draft ?? s.operatorNote ?? ''}
                        maxLength={limits.operatorNoteMaxLen}
                        onChange={(e) =>
                          setDraftNotes((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        placeholder="Why this is interesting, what to verify before publishing, etc."
                      />
                      {hasDraft && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                          <button
                            style={{ ...btn('#0ea5e9'), opacity: isBusy ? 0.6 : 1 }}
                            disabled={isBusy}
                            onClick={() => onUpdateNote(s.id)}
                          >
                            Save note
                          </button>
                          <button
                            style={btn('#475569')}
                            disabled={isBusy}
                            onClick={() =>
                              setDraftNotes((prev) => {
                                const next = { ...prev };
                                delete next[s.id];
                                return next;
                              })
                            }
                          >
                            Discard
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {statusOptions
                        .filter((opt) => opt !== s.status)
                        .map((opt) => (
                          <button
                            key={opt}
                            style={{ ...btn(opt === 'rejected' ? '#475569' : (opt === 'used' ? '#15803d' : '#7c3aed')), opacity: isBusy ? 0.6 : 1 }}
                            disabled={isBusy}
                            onClick={() => onUpdateStatus(s.id, opt)}
                            title={`Mark this saved idea as ${STATUS_LABELS[opt]}.`}
                          >
                            Mark {STATUS_LABELS[opt].toLowerCase()}
                          </button>
                        ))}
                      {/* Step 147 — create admin draft wager (NOT a publish). */}
                      <button
                        style={{
                          ...btn(s.status === 'rejected' ? '#475569' : '#a16207'),
                          opacity: isBusy || s.status === 'rejected' ? 0.5 : 1,
                          cursor: isBusy || s.status === 'rejected' ? 'not-allowed' : 'pointer',
                        }}
                        disabled={isBusy || s.status === 'rejected'}
                        onClick={() => onClickCreateDraft(s)}
                        title={
                          s.status === 'rejected'
                            ? 'Rejected ideas cannot create drafts. Restore status first.'
                            : 'Create an admin-only DRAFT wager from this idea. Drafts are NOT public and are NOT live until separately published.'
                        }
                      >
                        Create Draft Wager
                      </button>
                      <a
                        style={link('#0e7490')}
                        href={`/admin/wagers?${s.prefillQuery}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Opens the wager-create form pre-filled. You still have to click Create Wager."
                      >
                        Use this idea →
                      </a>
                      <button
                        style={{ ...btn('#7f1d1d'), marginLeft: 'auto', opacity: isBusy ? 0.6 : 1 }}
                        disabled={isBusy}
                        onClick={() => onDeleteSaved(s.id)}
                        title="Permanently remove this saved idea."
                      >
                        Delete
                      </button>
                    </div>

                    {/* Step 147 — flash result of last "Create Draft Wager" attempt. */}
                    {draftFlash && draftFlash.savedIdeaId === s.id && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '6px 8px',
                          borderRadius: 6,
                          background: draftFlash.error ? '#7f1d1d' : '#15803d',
                          color: '#fef2f2',
                          fontSize: 11,
                        }}
                      >
                        {draftFlash.error ? (
                          <>
                            <strong>Draft creation failed:</strong> {draftFlash.error}
                            {draftFlash.existingDraftId && (
                              <> (existing draft id: {draftFlash.existingDraftId})</>
                            )}
                          </>
                        ) : (
                          <>
                            <strong>Draft wager created:</strong> {draftFlash.draftId}.
                            Open the <button
                              type="button"
                              style={{ background: 'transparent', color: '#fef2f2', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 11 }}
                              onClick={() => setTab('drafts')}
                            >
                              Draft Wagers tab
                            </button> to review. Saved idea has been marked <strong>used</strong>.
                          </>
                        )}
                      </div>
                    )}

                    <div style={{ ...muted, fontSize: 10, marginTop: 8 }}>
                      Saved {new Date(s.createdAt).toLocaleString()} · updated {new Date(s.updatedAt).toLocaleString()} · id {s.id}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'drafts' && (
        <div style={card}>
          <h2 style={sectionHeader}>Draft wagers (admin-only)</h2>
          <div style={{ ...muted, marginBottom: 8 }}>
            Up to {limits.draftWagersCap} drafts. Drafts live in their own Redis namespace
            (<code>weather-market-draft-wager:*</code>) — they are <strong>not</strong> visible on
            <code> /api/wagers</code> or <code>/api/wagers/[id]</code>, and grading / settlement /
            wallet code paths do not see them. To publish, an admin must take a separate action
            (out of scope for Step 147).
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
            <button style={btn('#475569')} onClick={() => loadDraftWagers()}>
              Refresh
            </button>
          </div>

          {draftsError && (
            <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2', marginTop: 0 }}>
              <strong>Error:</strong> {draftsError}
            </div>
          )}

          {draftsLoading ? (
            <div style={muted}>Loading draft wagers…</div>
          ) : draftWagers.length === 0 ? (
            <div style={muted}>
              No draft wagers yet. From the <strong>Saved Ideas</strong> tab, click
              <strong> Create Draft Wager</strong> on an idea to seed one.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
              {draftWagers.map((d) => {
                const sm = d.summary;
                const isBusy = draftBusyId === d.id;
                return (
                  <div key={d.id} style={tile}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{sm.title}</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: d.status === 'published' ? '#22c55e' : '#a16207',
                          textTransform: 'uppercase',
                          border: `1px solid ${d.status === 'published' ? '#22c55e' : '#a16207'}`,
                          padding: '2px 6px',
                          borderRadius: 999,
                        }}
                      >
                        {d.status === 'published' ? 'PUBLISHED' : 'DRAFT'}
                      </span>
                    </div>
                    <div style={{ ...muted, marginTop: 4 }}>{sm.rulesCopy}</div>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                      <div>
                        <div style={muted}>Location A</div>
                        <div>{sm.locationAName ?? '—'} {sm.metricA && <span style={muted}>({sm.metricA})</span>}</div>
                      </div>
                      <div>
                        <div style={muted}>Location B</div>
                        <div>{sm.locationBName ?? '—'} {sm.metricB && <span style={muted}>({sm.metricB})</span>}</div>
                      </div>
                      <div>
                        <div style={muted}>Target date</div>
                        <div>{sm.targetDate}</div>
                      </div>
                      <div>
                        <div style={muted}>Spread (A side)</div>
                        <div style={{ fontWeight: 600 }}>
                          {sm.spread !== undefined ? `${sm.spread >= 0 ? '+' : ''}${sm.spread}°F` : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={muted}>Odds A / B</div>
                        <div>{sm.locationAOdds ?? '—'} / {sm.locationBOdds ?? '—'}</div>
                      </div>
                      <div>
                        <div style={muted}>Source idea</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 10 }}>{d.provenance.savedIdeaId}</div>
                      </div>
                    </div>

                    {sm.warnings.length > 0 && (
                      <ul style={{ marginTop: 8, color: '#fbbf24', fontSize: 11, paddingLeft: 16 }}>
                        {sm.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                      </ul>
                    )}

                    {/* Step 150 — duplicate / correlation warnings against the universe. */}
                    <RiskBadges warnings={draftRiskMap[d.id]} />

                    {d.operatorNote && (
                      <div style={{ marginTop: 8, padding: 8, background: '#1e293b', borderRadius: 6, fontSize: 12, color: '#cbd5e1' }}>
                        <span style={{ ...muted, fontSize: 10, display: 'block' }}>Operator note:</span>
                        {d.operatorNote}
                      </div>
                    )}

                    {/* Step 148 — published-state callout sits above the action row so
                        the operator sees the live wager id before they touch buttons. */}
                    {d.status === 'published' && d.publishedWagerId && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: '#15803d',
                          color: '#f0fdf4',
                          fontSize: 12,
                        }}
                      >
                        <strong>Published</strong> as live wager{' '}
                        <a
                          href={`/wagers/${encodeURIComponent(d.publishedWagerId)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#f0fdf4', textDecoration: 'underline' }}
                        >
                          {d.publishedWagerId}
                        </a>
                        {d.publishedAt && <> · {new Date(d.publishedAt).toLocaleString()}</>}
                      </div>
                    )}

                    {/* Step 148 — flash result of the most recent publish attempt. */}
                    {publishFlash && publishFlash.draftId === d.id && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '6px 8px',
                          borderRadius: 6,
                          background: publishFlash.error ? '#7f1d1d' : '#15803d',
                          color: '#fef2f2',
                          fontSize: 11,
                        }}
                      >
                        {publishFlash.error ? (
                          <>
                            <strong>Publish failed:</strong> {publishFlash.error}
                            {publishFlash.existingWagerId && (
                              <> (existing live wager: <code>{publishFlash.existingWagerId}</code>)</>
                            )}
                          </>
                        ) : (
                          <>
                            <strong>Published:</strong> live wager{' '}
                            {publishFlash.publishedWagerId && (
                              <a
                                href={`/wagers/${encodeURIComponent(publishFlash.publishedWagerId)}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#fef2f2', textDecoration: 'underline' }}
                              >
                                {publishFlash.publishedWagerId}
                              </a>
                            )}
                            {publishFlash.publishedTitle && <> — “{publishFlash.publishedTitle}”</>}
                            {publishFlash.qaId && (
                              <div style={{ marginTop: 6, color: '#fde68a', fontSize: 11 }}>
                                <strong>Published but QA pending.</strong> Open the{' '}
                                <button
                                  type="button"
                                  style={{ background: 'transparent', color: '#fde68a', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 11 }}
                                  onClick={() => setTab('qa')}
                                >
                                  Post-Publish QA tab
                                </button>{' '}
                                to walk the checklist before promoting this market.
                              </div>
                            )}
                            {publishFlash.warning && (
                              <div style={{ marginTop: 6, color: '#fde68a', fontSize: 11 }}>
                                <strong>Warning:</strong> {publishFlash.warning}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Step 148 — the explicit publish button. The "Open in wager-
                          create form →" link is still here below as a manual
                          alternative if the operator prefers to edit the input
                          before publishing. */}
                      <button
                        style={{
                          ...btn(d.status === 'published' ? '#475569' : '#15803d'),
                          opacity: isBusy || d.status === 'published' ? 0.6 : 1,
                          cursor: isBusy || d.status === 'published' ? 'not-allowed' : 'pointer',
                        }}
                        disabled={isBusy || d.status === 'published'}
                        onClick={() => onClickPublish(d)}
                        title={
                          d.status === 'published'
                            ? `This draft was already published as ${d.publishedWagerId}. Drafts can only be published once.`
                            : 'Publish this draft as a live wager. Requires explicit confirmation in the modal.'
                        }
                      >
                        {d.status === 'published' ? 'Published ✓' : 'Publish Draft Wager'}
                      </button>
                      <a
                        style={link('#0e7490')}
                        href={`/admin/wagers?${new URLSearchParams({
                          prefillKind: 'pointspread',
                          prefillMetric: sm.metric,
                          ...(sm.metricA ? { prefillMetricA: sm.metricA } : {}),
                          ...(sm.metricB ? { prefillMetricB: sm.metricB } : {}),
                          prefillLocationA: sm.locationAName ?? '',
                          prefillLocationB: sm.locationBName ?? '',
                          prefillSpread: String(sm.spread ?? ''),
                          prefillLocationAOdds: String(sm.locationAOdds ?? ''),
                          prefillLocationBOdds: String(sm.locationBOdds ?? ''),
                          prefillDate: sm.targetDate,
                          prefillTitle: sm.title,
                        }).toString()}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Opens the wager-create form pre-filled from this draft. Operator still has to click Create Wager."
                      >
                        Open in wager-create form →
                      </a>
                      <button
                        style={{ ...btn('#7f1d1d'), marginLeft: 'auto', opacity: isBusy ? 0.6 : 1 }}
                        disabled={isBusy}
                        onClick={() => onDeleteDraft(d.id)}
                        title={
                          d.status === 'published'
                            ? 'Delete the draft record. Does NOT remove the live wager — that lives in the normal wager store.'
                            : 'Delete this draft. Does not affect any published wager.'
                        }
                      >
                        {d.status === 'published' ? 'Delete draft record' : 'Delete draft'}
                      </button>
                    </div>

                    <div style={{ ...muted, fontSize: 10, marginTop: 8 }}>
                      Created {new Date(d.createdAt).toLocaleString()} · updated {new Date(d.updatedAt).toLocaleString()} · id {d.id}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 147 — Create Draft Wager confirmation modal. */}
      {draftConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={closeDraftConfirm}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: 8,
              padding: 20,
              maxWidth: 520,
              width: '100%',
              border: '1px solid #334155',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' }}>
              Create draft wager?
            </h3>
            <div
              style={{
                background: '#7f1d1d',
                color: '#fef2f2',
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              This creates an admin draft only. It is <strong>not public</strong> until separately published. Drafts do not enter the live wager store, do not grade, do not settle, and do not affect any wallet balances.
            </div>
            <div style={{ ...muted, marginBottom: 8 }}>
              <strong style={{ color: '#e2e8f0' }}>{draftConfirm.idea.title}</strong>
            </div>
            <div style={{ ...muted, marginBottom: 12 }}>
              Target date {draftConfirm.idea.targetDate} · suggested spread{' '}
              {draftConfirm.idea.suggestedSpread >= 0 ? '+' : ''}
              {draftConfirm.idea.suggestedSpread}°F (A side) · odds{' '}
              {draftConfirm.idea.suggestedOddsA}/{draftConfirm.idea.suggestedOddsB}
              {draftConfirm.idea.metricA !== draftConfirm.idea.metricB && (
                <>
                  {' '}· <span style={{ color: '#fbbf24' }}>cross-metric</span>
                </>
              )}
            </div>
            {draftConfirm.idea.warnings.length > 0 && (
              <ul style={{ marginTop: 4, marginBottom: 12, color: '#fbbf24', fontSize: 11, paddingLeft: 16 }}>
                {draftConfirm.idea.warnings.map((w, i) => (<li key={i}>{w}</li>))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={btn('#475569')} onClick={closeDraftConfirm}>
                Cancel
              </button>
              <button
                style={btn('#a16207')}
                onClick={() => onCreateDraftFromIdea(draftConfirm)}
              >
                Create draft (do not publish)
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'qa' && (
        <div style={card}>
          <h2 style={sectionHeader}>Post-publish QA checklist</h2>
          <div style={{ ...muted, marginBottom: 8 }}>
            Up to {limits.qaRecordsCap} QA records. Marking checklist items, changing
            QA status, or making notes here is <strong>operator-tracking only</strong>.
            It does <strong>not</strong> publish, unpublish, void, edit, or settle the
            underlying live wager. Use the existing admin wager-detail page for any
            actual changes to a published market.
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={muted}>Filter:</span>
            <button
              style={btn(qaFilter === 'all' ? '#0e7490' : '#334155')}
              onClick={() => setQaFilter('all')}
            >
              All
            </button>
            {qaStatusOptions.map((s) => (
              <button
                key={s}
                style={btn(qaFilter === s ? '#0e7490' : '#334155')}
                onClick={() => setQaFilter(s)}
              >
                {QA_STATUS_LABELS[s]}
              </button>
            ))}
            <button
              style={{ ...btn('#475569'), marginLeft: 'auto' }}
              onClick={() => loadMarketQA(qaFilter)}
            >
              Refresh
            </button>
          </div>

          {qaError && (
            <div style={{ ...card, background: '#7f1d1d', color: '#fef2f2', marginTop: 0 }}>
              <strong>Error:</strong> {qaError}
            </div>
          )}

          {qaLoading ? (
            <div style={muted}>Loading QA records…</div>
          ) : qaList.length === 0 ? (
            <div style={muted}>
              No QA records {qaFilter === 'all' ? 'yet' : `with status "${QA_STATUS_LABELS[qaFilter as MarketQAStatus]}"`}.
              {' '}Records are created automatically when an admin publishes a draft wager from the Drafts tab.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
              {qaList.map((qa) => {
                const sn = qa.snapshot;
                const isBusy = qaBusyId === qa.id;
                const checklist = getEffectiveChecklist(qa);
                const noteDraft = qaNoteDrafts[qa.id];
                const noteValue = noteDraft ?? qa.operatorNote ?? '';
                const hasChecklistDrift = qaChecklistDrafts[qa.id] !== undefined;
                const hasNoteDrift = noteDraft !== undefined && noteDraft !== (qa.operatorNote ?? '');
                const dirty = hasChecklistDrift || hasNoteDrift;
                const completed = CHECKLIST_ITEMS.filter((it) => checklist[it.key]).length;
                return (
                  <div key={qa.id} style={tile}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{sn.title}</div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: QA_STATUS_TONES[qa.status],
                          textTransform: 'uppercase',
                          border: `1px solid ${QA_STATUS_TONES[qa.status]}`,
                          padding: '2px 6px',
                          borderRadius: 999,
                        }}
                      >
                        {QA_STATUS_LABELS[qa.status]}
                      </span>
                    </div>

                    {qa.status === 'pending' && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: '#a16207',
                          color: '#fef3c7',
                          fontSize: 11,
                          fontWeight: 600,
                          display: 'inline-block',
                        }}
                      >
                        Published but QA pending
                      </div>
                    )}

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                      <div>
                        <div style={muted}>Live wager id</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>{qa.wagerId}</div>
                      </div>
                      <div>
                        <div style={muted}>Target date</div>
                        <div>{sn.targetDate}</div>
                      </div>
                      <div>
                        <div style={muted}>Location A</div>
                        <div>
                          {sn.locationAName ?? '—'}{' '}
                          {sn.metricA && <span style={muted}>({sn.metricA})</span>}
                        </div>
                      </div>
                      <div>
                        <div style={muted}>Location B</div>
                        <div>
                          {sn.locationBName ?? '—'}{' '}
                          {sn.metricB && <span style={muted}>({sn.metricB})</span>}
                        </div>
                      </div>
                      <div>
                        <div style={muted}>Spread (A side)</div>
                        <div style={{ fontWeight: 600 }}>
                          {sn.spread !== undefined ? `${sn.spread >= 0 ? '+' : ''}${sn.spread}°F` : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={muted}>Odds A / B</div>
                        <div>{sn.locationAOdds ?? '—'} / {sn.locationBOdds ?? '—'}</div>
                      </div>
                    </div>

                    {/* Step 150 — duplicate / correlation warnings against the universe. */}
                    <RiskBadges warnings={qaRiskMap[qa.id]} />

                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a
                        style={link('#0e7490')}
                        href={`/wagers/${encodeURIComponent(qa.wagerId)}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the public detail page for this wager."
                      >
                        Public page →
                      </a>
                      <a
                        style={link('#475569')}
                        href="/admin/wagers"
                        target="_blank"
                        rel="noreferrer"
                        title="Open the admin wagers dashboard. Locate this wager by id to edit."
                      >
                        Admin wagers →
                      </a>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...muted, marginBottom: 6 }}>
                        Checklist ({completed} of {CHECKLIST_ITEMS.length})
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {CHECKLIST_ITEMS.map((it) => (
                          <label
                            key={it.key}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '20px 1fr',
                              gap: 8,
                              alignItems: 'flex-start',
                              fontSize: 12,
                              color: '#e2e8f0',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checklist[it.key]}
                              onChange={(e) => setChecklistDraft(qa, it.key, e.target.checked)}
                              style={{ marginTop: 3 }}
                            />
                            <div>
                              <div style={{ fontWeight: 600 }}>{it.label}</div>
                              <div style={muted}>{it.help}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <span style={labelStyle}>
                        Operator note (≤{limits.qaOperatorNoteMaxLen} chars)
                      </span>
                      <textarea
                        style={{ ...textareaStyle, width: '100%' }}
                        value={noteValue}
                        maxLength={limits.qaOperatorNoteMaxLen}
                        onChange={(e) =>
                          setQaNoteDrafts((prev) => ({ ...prev, [qa.id]: e.target.value }))
                        }
                        placeholder="What was checked, what to follow up on, what to fix at the next iteration."
                      />
                    </div>

                    {dirty && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                        <button
                          style={{ ...btn('#0ea5e9'), opacity: isBusy ? 0.6 : 1 }}
                          disabled={isBusy}
                          onClick={() => onSaveQAChecklist(qa)}
                        >
                          Save checklist + note
                        </button>
                        <button
                          style={btn('#475569')}
                          disabled={isBusy}
                          onClick={() => {
                            setQaChecklistDrafts((prev) => {
                              const next = { ...prev };
                              delete next[qa.id];
                              return next;
                            });
                            setQaNoteDrafts((prev) => {
                              const next = { ...prev };
                              delete next[qa.id];
                              return next;
                            });
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    )}

                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {qaStatusOptions
                        .filter((opt) => opt !== qa.status)
                        .map((opt) => (
                          <button
                            key={opt}
                            style={{
                              ...btn(
                                opt === 'rejected'
                                  ? '#475569'
                                  : opt === 'passed'
                                    ? '#15803d'
                                    : opt === 'needs_changes'
                                      ? '#a16207'
                                      : '#7c3aed',
                              ),
                              opacity: isBusy ? 0.6 : 1,
                            }}
                            disabled={isBusy}
                            onClick={() => onUpdateQAStatus(qa, opt)}
                            title={`Mark this QA record as ${QA_STATUS_LABELS[opt]}. Does not affect the live wager.`}
                          >
                            Mark {QA_STATUS_LABELS[opt].toLowerCase()}
                          </button>
                        ))}
                    </div>

                    <div style={{ ...muted, fontSize: 10, marginTop: 8 }}>
                      Created {new Date(qa.createdAt).toLocaleString()} ·
                      {qa.reviewedAt && <> reviewed {new Date(qa.reviewedAt).toLocaleString()} ·</>}
                      {qa.reviewedBy && <> by {qa.reviewedBy} ·</>}{' '}
                      qa {qa.id} · draft {qa.sourceDraftId} · idea {qa.sourceIdeaId}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 151 — soft confirmation when an action's source has high-severity warnings.
          Always above the action-specific modals so the operator decides on warnings first. */}
      {highSevConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60, // above the Step 147/148 modals
            padding: 16,
          }}
          onClick={() => setHighSevConfirm(null)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: 8,
              padding: 20,
              maxWidth: 560,
              width: '100%',
              border: `1px solid ${RISK_SEVERITY_TONE.high}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' }}>
              High-severity market warnings
            </h3>
            <div
              style={{
                background: RISK_SEVERITY_TONE.high,
                color: '#fff',
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              These warnings do not prevent {highSevConfirm.actionLabel.toLowerCase()}, but they may indicate
              duplicate or correlated markets. Review before continuing.
            </div>
            <div style={{ ...muted, marginBottom: 8 }}>
              Item: <strong style={{ color: '#e2e8f0' }}>{highSevConfirm.candidateTitle}</strong>
            </div>
            <ul style={{ marginTop: 4, marginBottom: 12, color: '#fef2f2', fontSize: 12, paddingLeft: 16 }}>
              {highSevConfirm.warnings.map((w) => (
                <li key={w.id} style={{ marginBottom: 6 }}>
                  <strong>{w.title}</strong>
                  <div style={{ color: '#cbd5e1', marginTop: 2 }}>{w.description}</div>
                  {w.relatedTitles.length > 0 && (
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                      Related: {w.relatedTitles.slice(0, 4).join(' · ')}
                      {w.relatedTitles.length > 4 && <> · +{w.relatedTitles.length - 4} more</>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={btn('#475569')} onClick={() => setHighSevConfirm(null)}>
                Cancel
              </button>
              <button
                style={btn(RISK_SEVERITY_TONE.high)}
                onClick={() => highSevConfirm.onConfirm()}
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 148 — Publish Draft Wager confirmation modal. */}
      {publishConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={closePublishConfirm}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: 8,
              padding: 20,
              maxWidth: 580,
              width: '100%',
              border: '1px solid #334155',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#e2e8f0' }}>
              Publish draft wager?
            </h3>
            <div
              style={{
                background: '#7f1d1d',
                color: '#fef2f2',
                padding: '10px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              This creates a <strong>real wager</strong> in the normal wager system.
              Review the title, rules copy, target date, metrics, spread, and odds
              below before publishing. Once published, the wager enters the normal
              admin/manual creation lifecycle (locking, NWS-based grading,
              settlement, wallet payouts). There is no automatic rollback.
            </div>

            <div style={{ ...muted, marginBottom: 8 }}>
              <strong style={{ color: '#e2e8f0' }}>{publishConfirm.summary.title}</strong>
            </div>
            <div style={{ ...muted, marginBottom: 6 }}>
              {publishConfirm.summary.rulesCopy}
            </div>

            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div>
                <div style={muted}>Location A</div>
                <div>
                  {publishConfirm.summary.locationAName ?? '—'}{' '}
                  {publishConfirm.summary.metricA && (
                    <span style={muted}>({publishConfirm.summary.metricA})</span>
                  )}
                </div>
              </div>
              <div>
                <div style={muted}>Location B</div>
                <div>
                  {publishConfirm.summary.locationBName ?? '—'}{' '}
                  {publishConfirm.summary.metricB && (
                    <span style={muted}>({publishConfirm.summary.metricB})</span>
                  )}
                </div>
              </div>
              <div>
                <div style={muted}>Target date</div>
                <div>{publishConfirm.summary.targetDate}</div>
              </div>
              <div>
                <div style={muted}>Spread (A side)</div>
                <div style={{ fontWeight: 600 }}>
                  {publishConfirm.summary.spread !== undefined
                    ? `${publishConfirm.summary.spread >= 0 ? '+' : ''}${publishConfirm.summary.spread}°F`
                    : '—'}
                </div>
              </div>
              <div>
                <div style={muted}>Odds A / B</div>
                <div>
                  {publishConfirm.summary.locationAOdds ?? '—'} / {publishConfirm.summary.locationBOdds ?? '—'}
                </div>
              </div>
              <div>
                <div style={muted}>Source idea</div>
                <div style={{ fontFamily: 'monospace', fontSize: 10 }}>
                  {publishConfirm.provenance.savedIdeaId}
                </div>
              </div>
            </div>

            {publishConfirm.summary.warnings.length > 0 && (
              <ul style={{ marginTop: 10, color: '#fbbf24', fontSize: 11, paddingLeft: 16 }}>
                {publishConfirm.summary.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={btn('#475569')} onClick={closePublishConfirm}>
                Cancel
              </button>
              <button
                style={btn('#15803d')}
                onClick={() => onPublishDraft(publishConfirm)}
              >
                Publish as live wager
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <SystemNav activeHref="/admin/system/weather-market-ideas" />
      </div>
    </div>
  );
}
