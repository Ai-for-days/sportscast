import { useState, useEffect } from 'react';
import LocationSearch from '../search/LocationSearch';
import NWSStationPicker, { type NWSStation } from './NWSStationPicker';
import type { GeoLocation } from '../../lib/types';
import type { WagerKind, WagerMetric, OddsOutcome, OverUnderSide, PricingSnapshot, CreateWagerInput } from '../../lib/wager-types';
import WagerMarketDesignPanel from './WagerMarketDesignPanel';
import WagerPricingPanel, { type ApplySuggestion } from './WagerPricingPanel';
import { formatDMY } from '../../lib/date-format';

interface PrefillData {
  locationName: string;
  lat: number;
  lon: number;
  metric: WagerMetric;
  targetDate: string;
  targetTime?: string;
  forecastValue: number;
}

/** Prefill from Pricing Lab one-click creation */
export interface PricingPrefill {
  kind: WagerKind;
  metric?: string;
  targetDate?: string;
  targetTime?: string;
  locationName?: string;
  locationAName?: string;
  locationBName?: string;
  line?: number;
  overOdds?: number;
  underOdds?: number;
  spread?: number;
  locationAOdds?: number;
  locationBOdds?: number;
  bands?: { label: string; minValue: number; maxValue: number; offeredOdds: number }[];
  modelJson?: any; // raw model result for building pricingSnapshot
  // Step 145 — additional fields produced by the Weather Market Idea
  // Generator's "Use this idea" link. None of these auto-create a wager;
  // they only populate the form so the operator can review and submit.
  metricA?: string;
  metricB?: string;
  locationALat?: number;
  locationALon?: number;
  locationBLat?: number;
  locationBLon?: number;
  title?: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  editWager?: any;
  prefill?: PrefillData;
  pricingPrefill?: PricingPrefill;
}

// ── Metric definitions with by-time vs by-day ────────────────────────────────

type MetricCategory = 'by-time' | 'by-day';

const METRICS: { value: WagerMetric; label: string; titleLabel: string; category: MetricCategory }[] = [
  { value: 'actual_temp', label: 'Actual Temperature at Time (°F)', titleLabel: 'Temperature at Time', category: 'by-time' },
  { value: 'high_temp', label: 'Actual High Temperature for the Day (°F)', titleLabel: 'Daily High Temperature', category: 'by-day' },
  { value: 'low_temp', label: 'Actual Low Temperature for the Day (°F)', titleLabel: 'Daily Low Temperature', category: 'by-day' },
  { value: 'actual_wind', label: 'Actual High Wind for the Day (mph)', titleLabel: 'Wind Speed at Time', category: 'by-day' },
  { value: 'actual_gust', label: 'Actual High Gusts for the Day (mph)', titleLabel: 'Wind Gust at Time', category: 'by-day' },
];

// ── Auto-title generation ────────────────────────────────────────────────────

function formatDateForTitle(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDMY(new Date(y, m - 1, d));
}

function formatTimeForTitle(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

function generateAutoTitle(
  kind: WagerKind,
  metricValue: WagerMetric,
  locName: string | undefined,
  locAName: string | undefined,
  locBName: string | undefined,
  targetDate: string,
  targetTime: string,
  isByTime: boolean,
): string {
  const metricDef = METRICS.find(m => m.value === metricValue);
  const metricLabel = metricDef?.titleLabel || metricValue;
  const datePart = formatDateForTitle(targetDate);
  const timePart = isByTime && targetTime ? ` ${formatTimeForTitle(targetTime)}` : '';
  const dateTimePart = datePart ? ` — ${datePart}${timePart}` : '';

  if (kind === 'over-under') {
    return `${locName || ''} ${metricLabel}${dateTimePart}`.trim();
  }
  if (kind === 'odds') {
    return `${locName || ''} ${metricLabel} Range${dateTimePart}`.trim();
  }
  if (kind === 'pointspread') {
    return `${locAName || ''} vs ${locBName || ''} ${metricLabel} Spread${dateTimePart}`.trim();
  }
  return '';
}

// Generate 15-minute time slots
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      slots.push(`${hh}:${mm}`);
    }
  }
  return slots;
}

function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${ampm}`;
}

const TIME_SLOTS = generateTimeSlots();

function getCurrentTimeSlot(): string {
  const now = new Date();
  const h = now.getHours();
  const m = Math.round(now.getMinutes() / 15) * 15;
  const adjustedH = m === 60 ? h + 1 : h;
  const adjustedM = m === 60 ? 0 : m;
  const hh = (adjustedH % 24).toString().padStart(2, '0');
  const mm = adjustedM.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function WagerFormModal({ onClose, onSaved, editWager, prefill, pricingPrefill }: Props) {
  const pp = pricingPrefill;
  const init = editWager || prefill;
  const [kind, setKind] = useState<WagerKind>(pp?.kind || editWager?.kind || 'over-under');
  const [title, setTitle] = useState(editWager?.title || pp?.title || '');
  // Step 145 — when the idea generator prefills a title, treat it as
  // operator-edited so the auto-title effect doesn't immediately
  // overwrite it. The operator can still manually edit afterwards.
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(!!editWager?.title || !!pp?.title);
  const [description, setDescription] = useState(editWager?.description || '');
  const [metric, setMetric] = useState<WagerMetric>((pp?.metric as WagerMetric) || init?.metric || 'high_temp');
  // Step 145 — optional cross-metric per-side metrics for pointspread.
  // Only used (read + persisted) when kind === 'pointspread'.
  const [metricA, setMetricA] = useState<WagerMetric | ''>(
    (pp?.metricA as WagerMetric) || (editWager?.metricA as WagerMetric) || '',
  );
  const [metricB, setMetricB] = useState<WagerMetric | ''>(
    (pp?.metricB as WagerMetric) || (editWager?.metricB as WagerMetric) || '',
  );
  const [targetDate, setTargetDate] = useState(pp?.targetDate || init?.targetDate || '');
  const [targetTime, setTargetTime] = useState(pp?.targetTime || init?.targetTime || editWager?.targetTime || getCurrentTimeSlot());
  const [dateConfirmed, setDateConfirmed] = useState(!!(pp?.targetDate || init?.targetDate));
  const [location, setLocation] = useState<GeoLocation | null>(
    editWager?.location
      ? { lat: editWager.location.lat, lon: editWager.location.lon, name: editWager.location.name }
      : prefill
        ? { lat: prefill.lat, lon: prefill.lon, name: prefill.locationName }
        : pp?.locationName
          ? { lat: 0, lon: 0, name: pp.locationName }
          : null
  );

  // Odds
  const [outcomes, setOutcomes] = useState<OddsOutcome[]>(
    editWager?.outcomes
      ? editWager.outcomes
      : pp?.bands
        ? pp.bands.map((b: any) => ({ label: b.label, minValue: b.minValue, maxValue: b.maxValue, odds: b.offeredOdds }))
        : [{ label: '', minValue: 0, maxValue: 0, odds: 100 }]
  );

  // Over/Under
  const [line, setLine] = useState<string>(String(editWager?.line ?? pp?.line ?? (prefill ? prefill.forecastValue : '')));
  const [overOdds, setOverOdds] = useState<string>(String(editWager?.over?.odds ?? pp?.overOdds ?? '-110'));
  const [underOdds, setUnderOdds] = useState<string>(String(editWager?.under?.odds ?? pp?.underOdds ?? '-110'));

  // Pointspread
  const [locationA, setLocationA] = useState<GeoLocation | null>(
    editWager?.locationA
      ? { lat: editWager.locationA.lat, lon: editWager.locationA.lon, name: editWager.locationA.name }
      : pp?.locationAName
        // Step 145 — the idea generator passes lat/lon explicitly so the
        // server-side location resolver receives a real coordinate
        // instead of the 0,0 sentinel the legacy Pricing Lab path uses.
        ? { lat: pp.locationALat ?? 0, lon: pp.locationALon ?? 0, name: pp.locationAName }
        : null
  );
  const [locationB, setLocationB] = useState<GeoLocation | null>(
    editWager?.locationB
      ? { lat: editWager.locationB.lat, lon: editWager.locationB.lon, name: editWager.locationB.name }
      : pp?.locationBName
        ? { lat: pp.locationBLat ?? 0, lon: pp.locationBLon ?? 0, name: pp.locationBName }
        : null
  );
  const [spread, setSpread] = useState<string>(String(editWager?.spread ?? pp?.spread ?? ''));
  const [locationAOdds, setLocationAOdds] = useState<string>(String(editWager?.locationAOdds ?? pp?.locationAOdds ?? '-110'));
  const [locationBOdds, setLocationBOdds] = useState<string>(String(editWager?.locationBOdds ?? pp?.locationBOdds ?? '-110'));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [latestPricingRecId, setLatestPricingRecId] = useState<string | null>(null);

  // Optional operator override for when wagering closes. Empty string =
  // "use the auto default (15 min before target time, or 23:45 on
  // target date)". Stored as a datetime-local string in the operator's
  // browser timezone, converted to UTC ISO at save time.
  function isoToLocalInput(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const [lockTimeOverride, setLockTimeOverride] = useState<string>(
    editWager?.lockTime ? isoToLocalInput(editWager.lockTime) : ''
  );

  // Operator-picked NWS grading stations. Each is set by the station
  // picker after the corresponding location is chosen. Stored on the
  // wager so the public view can show players exactly which station
  // grades the market.
  const [station, setStation] = useState<NWSStation | null>(
    editWager?.location?.stationId
      ? {
          stationId: editWager.location.stationId,
          name: editWager.location.stationName || editWager.location.stationId,
          lat: 0,
          lon: 0,
          distanceMiles: 0,
          timeZone: editWager.location.timeZone,
        }
      : null,
  );
  const [stationA, setStationA] = useState<NWSStation | null>(
    editWager?.locationA?.stationId
      ? {
          stationId: editWager.locationA.stationId,
          name: editWager.locationA.stationName || editWager.locationA.stationId,
          lat: 0,
          lon: 0,
          distanceMiles: 0,
          timeZone: editWager.locationA.timeZone,
        }
      : null,
  );
  const [stationB, setStationB] = useState<NWSStation | null>(
    editWager?.locationB?.stationId
      ? {
          stationId: editWager.locationB.stationId,
          name: editWager.locationB.stationName || editWager.locationB.stationId,
          lat: 0,
          lon: 0,
          distanceMiles: 0,
          timeZone: editWager.locationB.timeZone,
        }
      : null,
  );

  // ── Pricing suggestions ───────────────────────────────────────────────────
  const [suggestingLines, setSuggestingLines] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  // Raw model results for building pricingSnapshot on save
  const [modelResult, setModelResult] = useState<any>(pp?.modelJson || null);

  const canSuggestLines = !!(location?.name && metric && targetDate && dateConfirmed && (kind === 'over-under' || kind === 'odds'));
  const canSuggestSpread = !!(locationA?.name && locationB?.name && metric && targetDate && dateConfirmed && kind === 'pointspread');

  const handleSuggestLines = async () => {
    if (!location?.name || !metric || !targetDate) return;
    setSuggestingLines(true);
    setSuggestError('');
    try {
      const params = new URLSearchParams({
        locationName: location.displayName || location.name,
        metric,
        targetDate,
      });
      if (isByTime && targetTime) params.set('targetTime', targetTime);
      const res = await fetch(`/api/admin/line-suggestions?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSuggestError(data.error || `No suggestions available (${res.status})`);
        return;
      }
      const data = await res.json();
      setModelResult(data);

      if (kind === 'over-under' && data.overUnder) {
        setLine(String(data.overUnder.line));
        setOverOdds(String(data.overUnder.overOdds));
        setUnderOdds(String(data.overUnder.underOdds));
      } else if (kind === 'odds' && data.rangeOdds?.bands) {
        const bands = data.rangeOdds.bands as { label: string; minValue: number; maxValue: number; offeredOdds: number }[];
        setOutcomes(bands.map(b => ({
          label: b.label,
          minValue: b.minValue,
          maxValue: b.maxValue,
          odds: b.offeredOdds,
        })));
      }
    } catch (err: any) {
      setSuggestError(err?.message || 'Failed to fetch suggestions');
    } finally {
      setSuggestingLines(false);
    }
  };

  const handleSuggestSpread = async () => {
    if (!locationA?.name || !locationB?.name || !metric || !targetDate) return;
    setSuggestingLines(true);
    setSuggestError('');
    try {
      const params = new URLSearchParams({
        locationAName: locationA.displayName || locationA.name,
        locationBName: locationB.displayName || locationB.name,
        metric,
        targetDate,
      });
      if (isByTime && targetTime) params.set('targetTime', targetTime);
      const res = await fetch(`/api/admin/pointspread-suggestions?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSuggestError(data.error || `No suggestions available (${res.status})`);
        return;
      }
      const data = await res.json();
      setModelResult(data);

      if (data.pointspread) {
        setSpread(String(data.pointspread.spread));
        setLocationAOdds(String(data.pointspread.locationAOdds));
        setLocationBOdds(String(data.pointspread.locationBOdds));
      }
    } catch (err: any) {
      setSuggestError(err?.message || 'Failed to fetch suggestions');
    } finally {
      setSuggestingLines(false);
    }
  };

  /** Build pricingSnapshot from model result + current (possibly edited) form values */
  const buildPricingSnapshot = (): PricingSnapshot | undefined => {
    if (!modelResult) return undefined;

    const snapshot: PricingSnapshot = {
      createdAt: new Date().toISOString(),
      source: 'model_v1',
      marketType: kind,
    };

    // Consensus
    const cons = modelResult.consensus || modelResult.pointspread?.locationAConsensus;
    if (cons) {
      snapshot.consensus = {
        mean: cons.mean,
        weightedMean: cons.weightedMean,
        stdDev: cons.stdDev,
        count: cons.count,
      };
    }

    if (kind === 'over-under' && modelResult.overUnder) {
      const m = modelResult.overUnder;
      snapshot.overUnder = {
        fairLine: m.fairLine,
        suggestedLine: m.line,
        suggestedOverOdds: m.overOdds,
        suggestedUnderOdds: m.underOdds,
        postedLine: Number(line),
        postedOverOdds: Number(overOdds),
        postedUnderOdds: Number(underOdds),
        hold: m.hold,
      };
    } else if (kind === 'odds' && modelResult.rangeOdds?.bands) {
      const modelBands = modelResult.rangeOdds.bands as any[];
      snapshot.rangeOdds = {
        bands: modelBands.map((mb: any, i: number) => ({
          label: mb.label,
          minValue: mb.minValue,
          maxValue: mb.maxValue,
          probability: mb.probability,
          fairOdds: mb.fairOdds,
          suggestedOdds: mb.offeredOdds,
          postedOdds: Number(outcomes[i]?.odds ?? mb.offeredOdds),
        })),
      };
    } else if (kind === 'pointspread' && modelResult.pointspread) {
      const m = modelResult.pointspread;
      snapshot.pointspread = {
        expectedDiff: m.expectedDiff,
        suggestedSpread: m.spread,
        diffStdDev: m.diffStdDev,
        suggestedLocationAOdds: m.locationAOdds,
        suggestedLocationBOdds: m.locationBOdds,
        postedSpread: Number(spread),
        postedLocationAOdds: Number(locationAOdds),
        postedLocationBOdds: Number(locationBOdds),
        hold: m.hold,
      };
    }

    return snapshot;
  };

  const selectedMetric = METRICS.find(m => m.value === metric);
  const isByTime = selectedMetric?.category === 'by-time';

  // Auto-generate title when key fields change (unless manually edited)
  useEffect(() => {
    if (titleManuallyEdited || editWager) return;
    const locName = location?.displayName || location?.name;
    const locAName = locationA?.displayName || locationA?.name;
    const locBName = locationB?.displayName || locationB?.name;
    const auto = generateAutoTitle(kind, metric, locName, locAName, locBName, targetDate, targetTime, !!isByTime);
    if (auto) setTitle(auto);
  }, [kind, metric, location, locationA, locationB, targetDate, targetTime, isByTime, titleManuallyEdited, editWager]);

  /**
   * Build a CreateWagerInput from current form state for the Market Design Lab.
   * Returns null if the bare minimum (title + targetDate + dateConfirmed) is not set —
   * the panel surfaces a friendly error in that case. This mirrors the payload that
   * handleSave constructs but is non-fatal: we tolerate missing fields so the analyzer
   * can comment on them, and we never call createWager from here.
   */
  // Merge a typed GeoLocation with the operator-picked NWS station so
  // the wager record carries both pieces straight through to the
  // server. When the operator hasn't picked one (e.g. legacy flow or
  // the picker hasn't loaded yet), only the location fields are sent
  // and the server falls back to auto-resolution.
  function buildLocationPayload(
    loc: { name: string; lat: number; lon: number },
    s: NWSStation | null,
  ): { name: string; lat: number; lon: number; stationId?: string; stationName?: string; timeZone?: string } {
    const payload: { name: string; lat: number; lon: number; stationId?: string; stationName?: string; timeZone?: string } = {
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
    };
    if (s?.stationId) {
      payload.stationId = s.stationId;
      payload.stationName = s.name;
      if (s.timeZone) payload.timeZone = s.timeZone;
    }
    return payload;
  }

  const buildProposal = (): CreateWagerInput | null => {
    if (!title.trim() || !targetDate || !dateConfirmed) return null;
    let lockTime: string | undefined;
    try {
      if (isByTime && targetTime) {
        const dt = new Date(`${targetDate}T${targetTime}:00`);
        dt.setMinutes(dt.getMinutes() - 15);
        lockTime = dt.toISOString();
      } else {
        lockTime = new Date(`${targetDate}T23:45:00`).toISOString();
      }
    } catch { /* leave lockTime undefined */ }

    const proposal: any = {
      kind,
      title,
      description: description || undefined,
      metric,
      targetDate,
      targetTime: isByTime ? targetTime : undefined,
      lockTime,
      pricingSnapshot: buildPricingSnapshot(),
    };
    if (kind === 'odds') {
      proposal.location = location ? buildLocationPayload(location, station) : undefined;
      proposal.outcomes = outcomes.map(o => ({ ...o, minValue: Number(o.minValue), maxValue: Number(o.maxValue), odds: Number(o.odds) }));
    } else if (kind === 'over-under') {
      proposal.location = location ? buildLocationPayload(location, station) : undefined;
      proposal.line = Number(line);
      proposal.over = { odds: Number(overOdds) } as OverUnderSide;
      proposal.under = { odds: Number(underOdds) } as OverUnderSide;
    } else {
      proposal.locationA = locationA ? buildLocationPayload(locationA, stationA) : undefined;
      proposal.locationB = locationB ? buildLocationPayload(locationB, stationB) : undefined;
      proposal.spread = Number(spread);
      proposal.locationAOdds = Number(locationAOdds);
      proposal.locationBOdds = Number(locationBOdds);
      // Step 145 — only emit metricA/metricB when the operator explicitly
      // chose cross-metric values. Same-metric pointspreads stay byte-
      // identical to the pre-Step-145 payload.
      if (metricA && metricA !== metric) proposal.metricA = metricA;
      if (metricB && metricB !== metric) proposal.metricB = metricB;
    }
    return proposal as CreateWagerInput;
  };

  /**
   * Apply suggested odds from the Pricing & Margin Engine into local form state.
   * This NEVER calls createWager and NEVER touches persisted data — it only
   * updates the unsaved form values so the operator can review and submit
   * manually via the Create Wager button.
   */
  const applySuggestedOdds = (apply: ApplySuggestion) => {
    if (apply.kind === 'odds') {
      // Match by label, fall back to position. Preserve existing min/max/label values.
      setOutcomes(prev => prev.map((o, i) => {
        const match = apply.outcomes.find(x => x.label === o.label) ?? apply.outcomes[i];
        return match ? { ...o, odds: match.odds } : o;
      }));
    } else if (apply.kind === 'over-under') {
      setOverOdds(String(apply.over));
      setUnderOdds(String(apply.under));
    } else if (apply.kind === 'pointspread') {
      setLocationAOdds(String(apply.locationA));
      setLocationBOdds(String(apply.locationB));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {

    // Validate required fields first
    if (!title.trim()) { setError('Title is required'); setSaving(false); return; }
    if (!targetDate) { setError('Please select a date and click Enter Date'); setSaving(false); return; }
    if (!dateConfirmed) { setError('Please click Enter Date to confirm your date'); setSaving(false); return; }

    // Lock time: by-time = 15 min before the selected time, by-day = 11:45 PM.
    // The operator can override either default by filling in the
    // "Wagering closes" field; in that case we use that value
    // (interpreted in the operator's local timezone) directly.
    let lockTime: string;
    if (lockTimeOverride) {
      const dt = new Date(lockTimeOverride);
      if (isNaN(dt.getTime())) {
        setError('Wagering Closes time is invalid');
        setSaving(false);
        return;
      }
      lockTime = dt.toISOString();
    } else if (isByTime) {
      const dt = new Date(`${targetDate}T${targetTime}:00`);
      dt.setMinutes(dt.getMinutes() - 15);
      lockTime = dt.toISOString();
    } else {
      lockTime = new Date(`${targetDate}T23:45:00`).toISOString();
    }

    // Note: when no override is set, this lockTime uses browser
    // timezone as an estimate; the server recomputes it using the
    // location's actual timezone.

    const pricingSnapshot = buildPricingSnapshot();

    const base: any = {
      kind,
      title,
      description: description || undefined,
      metric,
      targetDate,
      targetTime: isByTime ? targetTime : undefined,
      lockTime,
      pricingSnapshot,
    };

    if (kind === 'odds') {
      base.location = location ? buildLocationPayload(location, station) : undefined;
      base.outcomes = outcomes.map(o => ({ ...o, minValue: Number(o.minValue), maxValue: Number(o.maxValue), odds: Number(o.odds) }));
    } else if (kind === 'over-under') {
      base.location = location ? buildLocationPayload(location, station) : undefined;
      base.line = Number(line);
      base.over = { odds: Number(overOdds) } as OverUnderSide;
      base.under = { odds: Number(underOdds) } as OverUnderSide;
    } else {
      base.locationA = locationA ? buildLocationPayload(locationA, stationA) : undefined;
      base.locationB = locationB ? buildLocationPayload(locationB, stationB) : undefined;
      base.spread = Number(spread);
      base.locationAOdds = Number(locationAOdds);
      base.locationBOdds = Number(locationBOdds);
      if (metricA && metricA !== metric) base.metricA = metricA;
      if (metricB && metricB !== metric) base.metricB = metricB;
    }

      const url = editWager ? `/api/admin/wagers/${editWager.id}` : '/api/admin/wagers';
      const method = editWager ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.errors?.join(', ') || data.error || 'Save failed');
        return;
      }

      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const addOutcome = () => {
    setOutcomes([...outcomes, { label: '', minValue: 0, maxValue: 0, odds: 100 }]);
  };

  const updateOutcome = (i: number, field: keyof OddsOutcome, value: string | number) => {
    const updated = [...outcomes];
    (updated[i] as any)[field] = value;
    setOutcomes(updated);
  };

  const removeOutcome = (i: number) => {
    if (outcomes.length <= 1) return;
    setOutcomes(outcomes.filter((_, idx) => idx !== i));
  };

  const inputClass = 'w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none focus:border-field focus:ring-2 focus:ring-field/20';
  const labelClass = 'mb-1 block text-sm font-medium text-gray-500';
  const selectStyle = { color: '#111827' };
  const optionStyle = { backgroundColor: '#fff', color: '#111827' };

  return (
    <div className="light-theme fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-6 mb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {editWager ? 'Edit Wager' : 'Create Wager'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-900 text-xl" aria-label="Close">&times;</button>
        </div>

        <div className="space-y-4">
          {/* Wager Type */}
          <div>
            <label className={labelClass}>Wager Type</label>
            <select value={kind} onChange={e => setKind(e.target.value as WagerKind)} className={inputClass} style={selectStyle}>
              <option value="odds" style={optionStyle}>Odds</option>
              <option value="over-under" style={optionStyle}>Over/Under</option>
              <option value="pointspread" style={optionStyle}>Pointspread</option>
            </select>
          </div>

          {/* Title */}
          <div>
            <label className={labelClass}>Title {!titleManuallyEdited && title ? <span className="text-xs text-gray-400 font-normal">(auto-generated)</span> : ''}</label>
            <input value={title} onChange={e => { setTitle(e.target.value); setTitleManuallyEdited(true); }} className={inputClass} placeholder="Auto-generated from fields below, or type your own" />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className={inputClass} rows={2} placeholder="Optional context" />
          </div>

          {/* Location + NWS Station Picker.
              The picker fetches /api/admin/nws-stations whenever the
              location's lat/lon changes, defaults to the nearest one,
              and lets the operator pick a different candidate. The
              chosen station is shown to players via locationSummary,
              so they always know which station grades the market. */}
          {kind !== 'pointspread' ? (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Location</label>
                <LocationSearch
                  onSelect={(loc: GeoLocation) => { setLocation(loc); setStation(null); }}
                  placeholder="Search for a city or ZIP..."
                  defaultValue={location?.name || ''}
                />
              </div>
              <NWSStationPicker
                lat={location?.lat ?? null}
                lon={location?.lon ?? null}
                value={station?.stationId}
                onChange={setStation}
                inputClass={inputClass}
                selectStyle={selectStyle}
                optionStyle={optionStyle}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Location A</label>
                  <LocationSearch
                    onSelect={(loc: GeoLocation) => { setLocationA(loc); setStationA(null); }}
                    placeholder="City A..."
                    defaultValue={locationA?.name || ''}
                  />
                </div>
                <div>
                  <label className={labelClass}>Location B</label>
                  <LocationSearch
                    onSelect={(loc: GeoLocation) => { setLocationB(loc); setStationB(null); }}
                    placeholder="City B..."
                    defaultValue={locationB?.name || ''}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <NWSStationPicker
                  lat={locationA?.lat ?? null}
                  lon={locationA?.lon ?? null}
                  value={stationA?.stationId}
                  onChange={setStationA}
                  label="NWS Grading Station — Location A"
                  inputClass={inputClass}
                  selectStyle={selectStyle}
                  optionStyle={optionStyle}
                />
                <NWSStationPicker
                  lat={locationB?.lat ?? null}
                  lon={locationB?.lon ?? null}
                  value={stationB?.stationId}
                  onChange={setStationB}
                  label="NWS Grading Station — Location B"
                  inputClass={inputClass}
                  selectStyle={selectStyle}
                  optionStyle={optionStyle}
                />
              </div>
            </div>
          )}

          {/* Metric */}
          <div>
            <label className={labelClass}>Metric</label>
            <select value={metric} onChange={e => { setMetric(e.target.value as WagerMetric); setDateConfirmed(false); }} className={inputClass} style={selectStyle}>
              <optgroup label="By Time (15-min increments)" style={optionStyle}>
                {METRICS.filter(m => m.category === 'by-time').map(m => (
                  <option key={m.value} value={m.value} style={optionStyle}>{m.label}</option>
                ))}
              </optgroup>
              <optgroup label="By Day" style={optionStyle}>
                {METRICS.filter(m => m.category === 'by-day').map(m => (
                  <option key={m.value} value={m.value} style={optionStyle}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Target Date + Time */}
          <div>
            <label className={labelClass}>
              {isByTime
                ? kind === 'pointspread' ? 'Target Date & Time (Location A\u2019s local time)' : 'Target Date & Time'
                : 'Target Date'}
            </label>
            <div className="rounded-lg border border-gray-200 bg-gray-100 p-3 space-y-3">
              <input
                type="date"
                value={targetDate}
                onChange={e => { setTargetDate(e.target.value); setDateConfirmed(false); }}
                className={`${inputClass} text-center`}
                style={{ colorScheme: 'light' }}
              />
              {isByTime && (
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {kind === 'pointspread' ? 'Time at Location A (15-min increments)' : 'Time (15-min increments)'}
                  </label>
                  <select
                    value={targetTime}
                    onChange={e => { setTargetTime(e.target.value); setDateConfirmed(false); }}
                    className={inputClass}
                    style={selectStyle}
                  >
                    {TIME_SLOTS.map(t => (
                      <option key={t} value={t} style={optionStyle}>{formatTime12h(t)}</option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={() => setDateConfirmed(true)}
                disabled={!targetDate}
                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  dateConfirmed
                    ? 'bg-green-600 text-white'
                    : 'bg-field text-white hover:bg-field-light disabled:opacity-50'
                }`}
              >
                {dateConfirmed ? 'Date Entered' : 'Enter Date'}
              </button>
              {dateConfirmed && (() => {
                const lockDt = isByTime
                  ? (() => { const d = new Date(`${targetDate}T${targetTime}:00`); d.setMinutes(d.getMinutes() - 15); return d; })()
                  : new Date(`${targetDate}T23:45:00`);
                const minsUntilLock = Math.round((lockDt.getTime() - Date.now()) / 60000);
                const lockPassed = minsUntilLock <= 0;
                const lockSoon = !lockPassed && minsUntilLock < 30;
                return (
                  <>
                    <p className="text-xs text-gray-500 text-center">
                      {isByTime
                        ? `Locks 15 min before ${formatTime12h(targetTime)} on ${targetDate}${kind === 'pointspread' ? ' (Location A\u2019s local time)' : ''}`
                        : `Locks at 11:45 PM on ${targetDate}`
                      }
                    </p>
                    {lockPassed && (
                      <p className="text-xs text-red-600 font-semibold text-center">
                        Lock time has already passed — players won't see this wager. Choose a later date/time.
                      </p>
                    )}
                    {lockSoon && (
                      <p className="text-xs text-orange-600 font-semibold text-center">
                        Lock time is only {minsUntilLock} minute{minsUntilLock !== 1 ? 's' : ''} away — players may not have time to bet.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Wagering Closes (lockTime override) */}
          <div>
            <label className={labelClass}>
              Wagering Closes <span className="text-gray-400 font-normal">(optional override)</span>
            </label>
            <div className="rounded-lg border border-gray-200 bg-gray-100 p-3 space-y-2">
              <input
                type="datetime-local"
                value={lockTimeOverride}
                onChange={e => setLockTimeOverride(e.target.value)}
                className={inputClass}
                style={{ colorScheme: 'light' }}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  Leave blank to use the auto default ({isByTime ? '15 min before target time' : '11:45 PM on target date'}).
                  Times are in your browser timezone.
                </p>
                {lockTimeOverride && (
                  <button
                    type="button"
                    onClick={() => setLockTimeOverride('')}
                    className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Generate Suggested Lines / Spread ── */}
          {(kind === 'over-under' || kind === 'odds') && (
            <div>
              <button
                onClick={handleSuggestLines}
                disabled={!canSuggestLines || suggestingLines}
                className="w-full rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {suggestingLines ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  'Generate Suggested Lines'
                )}
              </button>
              {!canSuggestLines && !suggestingLines && (
                <p className="mt-1 text-xs text-gray-400">
                  Select a location, metric, and confirm a date to generate suggestions.
                </p>
              )}
              {suggestError && (
                <p className="mt-1 text-xs text-red-600">{suggestError}</p>
              )}
            </div>
          )}
          {kind === 'pointspread' && (
            <div>
              <button
                onClick={handleSuggestSpread}
                disabled={!canSuggestSpread || suggestingLines}
                className="w-full rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {suggestingLines ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  'Generate Suggested Spread'
                )}
              </button>
              {!canSuggestSpread && !suggestingLines && (
                <p className="mt-1 text-xs text-gray-400">
                  Select both locations, metric, and confirm a date to generate suggestions.
                </p>
              )}
              {suggestError && (
                <p className="mt-1 text-xs text-red-600">{suggestError}</p>
              )}
            </div>
          )}

          {/* ── Kind-specific fields ── */}

          {kind === 'odds' && (
            <>
              <hr className="border-gray-200" />
              <div className="rounded-lg border border-gray-200 bg-gray-100 px-4 py-3 text-xs text-gray-500 space-y-1">
                <p className="font-semibold text-gray-900">American Odds Guide:</p>
                <p><span className="font-mono text-green-600">+150</span> — Bet $100 to win $150 (underdog)</p>
                <p><span className="font-mono text-red-600">-110</span> — Bet $110 to win $100 (favorite)</p>
                <p><span className="font-mono text-gray-900">+100</span> — Even money (bet $100 to win $100)</p>
              </div>
              <p className="text-sm text-gray-500">Define each outcome range and its odds:</p>
              {outcomes.map((o, i) => (
                <div key={i} className="rounded-lg border border-gray-200 bg-gray-100 p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className={labelClass}>Outcome Label</label>
                      <input value={o.label} onChange={e => updateOutcome(i, 'label', e.target.value)} className={inputClass} placeholder="e.g. 60-62°F" />
                    </div>
                    {outcomes.length > 1 && (
                      <button type="button" onClick={() => removeOutcome(i)} className="mb-1 px-2 text-red-600 hover:text-alert" title="Remove this outcome from the form (does not delete any saved data)">
                        &times;
                      </button>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="w-1/3">
                      <label className={labelClass}>Min Value</label>
                      <input type="text" inputMode="numeric" value={o.minValue} onChange={e => updateOutcome(i, 'minValue', e.target.value)} className={inputClass} placeholder="60" />
                    </div>
                    <div className="w-1/3">
                      <label className={labelClass}>Max Value</label>
                      <input type="text" inputMode="numeric" value={o.maxValue} onChange={e => updateOutcome(i, 'maxValue', e.target.value)} className={inputClass} placeholder="62" />
                    </div>
                    <div className="w-1/3">
                      <label className={labelClass}>American Odds</label>
                      <input type="text" inputMode="numeric" value={o.odds} onChange={e => updateOutcome(i, 'odds', e.target.value)} className={inputClass} placeholder="+135 or -110" />
                    </div>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addOutcome} className="text-sm text-blue-600 hover:underline" title="Add an outcome row to this form (does not save anything yet)">
                + Add outcome
              </button>
            </>
          )}

          {kind === 'over-under' && (
            <>
              <hr className="border-gray-200" />
              <div>
                <label className={labelClass}>Line (the number to go over or under)</label>
                <input type="text" inputMode="numeric" value={line} onChange={e => setLine(e.target.value)} className={inputClass} placeholder="e.g. 61" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Over Odds</label>
                  <input type="text" inputMode="numeric" value={overOdds} onChange={e => setOverOdds(e.target.value)} className={inputClass} placeholder="-110" />
                  <p className="mt-1 text-xs text-gray-500">e.g. -110, +120</p>
                </div>
                <div>
                  <label className={labelClass}>Under Odds</label>
                  <input type="text" inputMode="numeric" value={underOdds} onChange={e => setUnderOdds(e.target.value)} className={inputClass} placeholder="-110" />
                  <p className="mt-1 text-xs text-gray-500">e.g. -110, +100</p>
                </div>
              </div>
            </>
          )}

          {kind === 'pointspread' && (
            <>
              <hr className="border-gray-200" />
              <div>
                <label className={labelClass}>Spread (A minus B)</label>
                <input type="text" inputMode="numeric" value={spread} onChange={e => setSpread(e.target.value)} className={inputClass} placeholder="10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Location A Odds</label>
                  <input type="text" inputMode="numeric" value={locationAOdds} onChange={e => setLocationAOdds(e.target.value)} className={inputClass} placeholder="-110" />
                </div>
                <div>
                  <label className={labelClass}>Location B Odds</label>
                  <input type="text" inputMode="numeric" value={locationBOdds} onChange={e => setLocationBOdds(e.target.value)} className={inputClass} placeholder="-110" />
                </div>
              </div>
              {/* Step 145 — optional cross-metric per-side metric overrides.
                  Leave blank to use the shared Metric above on both sides. */}
              <div className="rounded-lg border border-gray-200 bg-gray-100 p-3 space-y-2">
                <div className="text-xs font-semibold text-gray-700">
                  Cross-metric pointspread (optional)
                </div>
                <p className="text-xs text-gray-500">
                  Leave blank to use the Metric above on both sides. Set per-side metrics to build a market like &ldquo;Dallas High vs Seattle Low.&rdquo; Settlement reads each side from its own metric.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Location A Metric (optional)</label>
                    <select
                      value={metricA}
                      onChange={e => setMetricA(e.target.value as WagerMetric | '')}
                      className={inputClass}
                      style={selectStyle}
                    >
                      <option value="" style={optionStyle}>(use shared metric)</option>
                      {METRICS.map(m => (
                        <option key={m.value} value={m.value} style={optionStyle}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Location B Metric (optional)</label>
                    <select
                      value={metricB}
                      onChange={e => setMetricB(e.target.value as WagerMetric | '')}
                      className={inputClass}
                      style={selectStyle}
                    >
                      <option value="" style={optionStyle}>(use shared metric)</option>
                      {METRICS.map(m => (
                        <option key={m.value} value={m.value} style={optionStyle}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Pricing & Margin Engine — advisory only, never publishes */}
          <WagerPricingPanel
            getProposal={buildProposal}
            onApplySuggestedOdds={applySuggestedOdds}
            onRecommendationGenerated={setLatestPricingRecId}
          />

          {/* Market Design Lab — advisory only, never publishes */}
          <WagerMarketDesignPanel
            getProposal={buildProposal}
            latestPricingRecId={latestPricingRecId}
          />

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* Submit */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              title={editWager ? 'Update this wager. Persists to wager:* and wagers:by-status indices.' : 'Create the wager and persist it. Locks at the time shown above.'}
              className="rounded-lg bg-field px-6 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
            >
              {saving ? 'Saving...' : editWager ? 'Update Wager' : 'Create Wager'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
