import { useState } from 'react';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation } from '../../lib/types';
import type { WagerKind, WagerMetric, OddsOutcome, OverUnderSide } from '../../lib/wager-types';

interface PrefillData {
  locationName: string;
  lat: number;
  lon: number;
  metric: WagerMetric;
  targetDate: string;
  targetTime?: string;
  forecastValue: number;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  editWager?: any;
  prefill?: PrefillData;
}

// ── Metric definitions with by-time vs by-day ────────────────────────────────

type MetricCategory = 'by-time' | 'by-day';

const METRICS: { value: WagerMetric; label: string; category: MetricCategory }[] = [
  { value: 'actual_temp', label: 'Actual Temperature at Time (°F)', category: 'by-time' },
  { value: 'high_temp', label: 'Actual High Temperature for the Day (°F)', category: 'by-day' },
  { value: 'low_temp', label: 'Actual Low Temperature for the Day (°F)', category: 'by-day' },
  { value: 'actual_wind', label: 'Actual High Wind for the Day (mph)', category: 'by-day' },
  { value: 'actual_gust', label: 'Actual High Gusts for the Day (mph)', category: 'by-day' },
];

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

export default function WagerFormModal({ onClose, onSaved, editWager, prefill }: Props) {
  const init = editWager || prefill;
  const [kind, setKind] = useState<WagerKind>(editWager?.kind || 'over-under');
  const [title, setTitle] = useState(editWager?.title || (prefill ? `${prefill.locationName} — ${METRICS.find(m => m.value === prefill.metric)?.label || prefill.metric}` : ''));
  const [description, setDescription] = useState(editWager?.description || '');
  const [metric, setMetric] = useState<WagerMetric>(init?.metric || 'high_temp');
  const [targetDate, setTargetDate] = useState(init?.targetDate || '');
  const [targetTime, setTargetTime] = useState(init?.targetTime || editWager?.targetTime || getCurrentTimeSlot());
  const [dateConfirmed, setDateConfirmed] = useState(!!init?.targetDate);
  const [location, setLocation] = useState<GeoLocation | null>(
    editWager?.location
      ? { lat: editWager.location.lat, lon: editWager.location.lon, name: editWager.location.name }
      : prefill
        ? { lat: prefill.lat, lon: prefill.lon, name: prefill.locationName }
        : null
  );

  // Odds
  const [outcomes, setOutcomes] = useState<OddsOutcome[]>(
    editWager?.outcomes || [
      { label: '', minValue: 0, maxValue: 0, odds: 100 },
    ]
  );

  // Over/Under
  const [line, setLine] = useState<string>(String(editWager?.line ?? (prefill ? prefill.forecastValue : '')));
  const [overOdds, setOverOdds] = useState<string>(String(editWager?.over?.odds ?? '-110'));
  const [underOdds, setUnderOdds] = useState<string>(String(editWager?.under?.odds ?? '-110'));

  // Pointspread
  const [locationA, setLocationA] = useState<GeoLocation | null>(
    editWager?.locationA ? { lat: editWager.locationA.lat, lon: editWager.locationA.lon, name: editWager.locationA.name } : null
  );
  const [locationB, setLocationB] = useState<GeoLocation | null>(
    editWager?.locationB ? { lat: editWager.locationB.lat, lon: editWager.locationB.lon, name: editWager.locationB.name } : null
  );
  const [spread, setSpread] = useState<string>(String(editWager?.spread ?? ''));
  const [locationAOdds, setLocationAOdds] = useState<string>(String(editWager?.locationAOdds ?? '-110'));
  const [locationBOdds, setLocationBOdds] = useState<string>(String(editWager?.locationBOdds ?? '-110'));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedMetric = METRICS.find(m => m.value === metric);
  const isByTime = selectedMetric?.category === 'by-time';

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {

    // Validate required fields first
    if (!title.trim()) { setError('Title is required'); setSaving(false); return; }
    if (!targetDate) { setError('Please select a date and click Enter Date'); setSaving(false); return; }
    if (!dateConfirmed) { setError('Please click Enter Date to confirm your date'); setSaving(false); return; }

    // Lock time: by-time = 15 min before the selected time, by-day = 11:45 PM
    let lockTime: string;
    if (isByTime) {
      const dt = new Date(`${targetDate}T${targetTime}:00`);
      dt.setMinutes(dt.getMinutes() - 15);
      lockTime = dt.toISOString();
    } else {
      lockTime = new Date(`${targetDate}T23:45:00`).toISOString();
    }

    // Prevent creating wagers whose lock time has already passed
    if (new Date(lockTime).getTime() <= Date.now()) {
      setError('Lock time has already passed. Choose a later date/time — the wager locks 15 minutes before the target time.');
      setSaving(false);
      return;
    }

    const base: any = {
      kind,
      title,
      description: description || undefined,
      metric,
      targetDate,
      targetTime: isByTime ? targetTime : undefined,
      lockTime,
    };

    if (kind === 'odds') {
      base.location = location ? { name: location.name, lat: location.lat, lon: location.lon } : undefined;
      base.outcomes = outcomes.map(o => ({ ...o, minValue: Number(o.minValue), maxValue: Number(o.maxValue), odds: Number(o.odds) }));
    } else if (kind === 'over-under') {
      base.location = location ? { name: location.name, lat: location.lat, lon: location.lon } : undefined;
      base.line = Number(line);
      base.over = { odds: Number(overOdds) } as OverUnderSide;
      base.under = { odds: Number(underOdds) } as OverUnderSide;
    } else {
      base.locationA = locationA ? { name: locationA.name, lat: locationA.lat, lon: locationA.lon } : undefined;
      base.locationB = locationB ? { name: locationB.name, lat: locationB.lat, lon: locationB.lon } : undefined;
      base.spread = Number(spread);
      base.locationAOdds = Number(locationAOdds);
      base.locationBOdds = Number(locationBOdds);
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-6 mb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {editWager ? 'Edit Wager' : 'Create Wager'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 text-xl">&times;</button>
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
            <label className={labelClass}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="e.g. Seattle High Temp Tomorrow" />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className={inputClass} rows={2} placeholder="Optional context" />
          </div>

          {/* Location */}
          {kind !== 'pointspread' ? (
            <div>
              <label className={labelClass}>Location</label>
              <LocationSearch
                onSelect={(loc: GeoLocation) => setLocation(loc)}
                placeholder="Search for a city..."
                defaultValue={location?.name || ''}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Location A</label>
                <LocationSearch
                  onSelect={(loc: GeoLocation) => setLocationA(loc)}
                  placeholder="City A..."
                  defaultValue={locationA?.name || ''}
                />
              </div>
              <div>
                <label className={labelClass}>Location B</label>
                <LocationSearch
                  onSelect={(loc: GeoLocation) => setLocationB(loc)}
                  placeholder="City B..."
                  defaultValue={locationB?.name || ''}
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
                      <button onClick={() => removeOutcome(i)} className="mb-1 px-2 text-red-600 hover:text-alert" title="Remove">
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
              <button onClick={addOutcome} className="text-sm text-blue-600 hover:underline">
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
            </>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-red-600">{error}</div>
          )}

          {/* Submit */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
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
