import { useState } from 'react';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation } from '../../lib/types';
import type { WagerKind, WagerMetric, OddsOutcome, OverUnderSide } from '../../lib/wager-types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
  editWager?: any;
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

export default function WagerFormModal({ onClose, onSaved, editWager }: Props) {
  const [kind, setKind] = useState<WagerKind>(editWager?.kind || 'odds');
  const [title, setTitle] = useState(editWager?.title || '');
  const [description, setDescription] = useState(editWager?.description || '');
  const [metric, setMetric] = useState<WagerMetric>(editWager?.metric || 'high_temp');
  const [targetDate, setTargetDate] = useState(editWager?.targetDate || '');
  const [targetTime, setTargetTime] = useState(editWager?.targetTime || '12:00');
  const [dateConfirmed, setDateConfirmed] = useState(!!editWager?.targetDate);
  const [location, setLocation] = useState<GeoLocation | null>(
    editWager?.location ? { lat: editWager.location.lat, lon: editWager.location.lon, name: editWager.location.name } : null
  );

  // Odds
  const [outcomes, setOutcomes] = useState<OddsOutcome[]>(
    editWager?.outcomes || [
      { label: '', minValue: 0, maxValue: 0, odds: 100 },
    ]
  );

  // Over/Under
  const [line, setLine] = useState<string>(String(editWager?.line ?? ''));
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

    // Lock time: by-time = 15 min before the selected time, by-day = 11:45 PM
    let lockTime: string;
    if (isByTime) {
      const dt = new Date(`${targetDate}T${targetTime}:00`);
      dt.setMinutes(dt.getMinutes() - 15);
      lockTime = dt.toISOString();
    } else {
      lockTime = new Date(`${targetDate}T23:45:00`).toISOString();
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

    try {
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
    } catch {
      setError('Network error');
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

  const inputClass = 'w-full rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none focus:border-field focus:ring-2 focus:ring-field/20';
  const labelClass = 'mb-1 block text-sm font-medium text-text-dark-muted';
  const selectStyle = { color: '#fff' };
  const optionStyle = { backgroundColor: '#0c2952', color: '#fff' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-10" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-border-dark bg-surface-dark-alt p-6 mb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-dark">
            {editWager ? 'Edit Wager' : 'Create Wager'}
          </h2>
          <button onClick={onClose} className="text-text-dark-muted hover:text-text-dark text-xl">&times;</button>
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
            <label className={labelClass}>{isByTime ? 'Target Date & Time' : 'Target Date'}</label>
            <div className="rounded-lg border border-border-dark bg-surface-dark p-3 space-y-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-text-dark-muted">Date</label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={e => { setTargetDate(e.target.value); setDateConfirmed(false); }}
                    className={inputClass}
                  />
                </div>
                {isByTime && (
                  <div className="w-36">
                    <label className="mb-1 block text-xs text-text-dark-muted">Time</label>
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
              </div>
              <button
                onClick={() => setDateConfirmed(true)}
                disabled={!targetDate}
                className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  dateConfirmed
                    ? 'bg-green-600 text-white'
                    : 'bg-field text-white hover:bg-field-light disabled:opacity-50'
                }`}
              >
                {dateConfirmed ? 'Entered' : 'Enter'}
              </button>
              {dateConfirmed && (
                <p className="text-xs text-text-dark-muted text-center">
                  {isByTime
                    ? `Locks 15 min before ${formatTime12h(targetTime)} on ${targetDate}`
                    : `Locks at 11:45 PM on ${targetDate}`
                  }
                </p>
              )}
            </div>
          </div>

          {/* ── Kind-specific fields ── */}

          {kind === 'odds' && (
            <>
              <hr className="border-border-dark" />
              <div className="rounded-lg border border-border-dark bg-surface-dark px-4 py-3 text-xs text-text-dark-muted space-y-1">
                <p className="font-semibold text-text-dark">American Odds Guide:</p>
                <p><span className="font-mono text-green-400">+150</span> — Bet $100 to win $150 (underdog)</p>
                <p><span className="font-mono text-red-400">-110</span> — Bet $110 to win $100 (favorite)</p>
                <p><span className="font-mono text-text-dark">+100</span> — Even money (bet $100 to win $100)</p>
              </div>
              <p className="text-sm text-text-dark-muted">Define each outcome range and its odds:</p>
              {outcomes.map((o, i) => (
                <div key={i} className="rounded-lg border border-border-dark bg-surface-dark p-3 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className={labelClass}>Outcome Label</label>
                      <input value={o.label} onChange={e => updateOutcome(i, 'label', e.target.value)} className={inputClass} placeholder="e.g. 60-62°F" />
                    </div>
                    {outcomes.length > 1 && (
                      <button onClick={() => removeOutcome(i)} className="mb-1 px-2 text-alert-light hover:text-alert" title="Remove">
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
              <button onClick={addOutcome} className="text-sm text-field-light hover:underline">
                + Add outcome
              </button>
            </>
          )}

          {kind === 'over-under' && (
            <>
              <hr className="border-border-dark" />
              <div>
                <label className={labelClass}>Line (the number to go over or under)</label>
                <input type="text" inputMode="numeric" value={line} onChange={e => setLine(e.target.value)} className={inputClass} placeholder="e.g. 61" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Over Odds</label>
                  <input type="text" inputMode="numeric" value={overOdds} onChange={e => setOverOdds(e.target.value)} className={inputClass} placeholder="-110" />
                  <p className="mt-1 text-xs text-text-dark-muted">e.g. -110, +120</p>
                </div>
                <div>
                  <label className={labelClass}>Under Odds</label>
                  <input type="text" inputMode="numeric" value={underOdds} onChange={e => setUnderOdds(e.target.value)} className={inputClass} placeholder="-110" />
                  <p className="mt-1 text-xs text-text-dark-muted">e.g. -110, +100</p>
                </div>
              </div>
            </>
          )}

          {kind === 'pointspread' && (
            <>
              <hr className="border-border-dark" />
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
            <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-alert-light">{error}</div>
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
