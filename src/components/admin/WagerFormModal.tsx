import { useState } from 'react';
import LocationSearch from '../search/LocationSearch';
import type { GeoLocation } from '../../lib/types';
import type { WagerKind, WagerMetric, OddsOutcome, OverUnderSide } from '../../lib/wager-types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
  editWager?: any; // pass existing wager for editing
}

const METRICS: { value: WagerMetric; label: string }[] = [
  { value: 'actual_temp', label: 'Actual Temperature (°F)' },
  { value: 'high_temp', label: 'Actual High (°F)' },
  { value: 'low_temp', label: 'Actual Low (°F)' },
  { value: 'precip', label: 'Precipitation (in)' },
  { value: 'wind_speed', label: 'Wind (mph)' },
  { value: 'wind_gust', label: 'Gusts (mph)' },
  { value: 'actual_wind', label: 'Actual Wind (mph)' },
  { value: 'actual_gust', label: 'Actual Gusts (mph)' },
];

const KINDS: { value: WagerKind; label: string; desc: string }[] = [
  { value: 'odds', label: 'Odds', desc: 'Multiple outcomes with American odds' },
  { value: 'over-under', label: 'Over/Under', desc: 'Single line, over or under' },
  { value: 'pointspread', label: 'Pointspread', desc: 'Two locations, spread comparison' },
];

export default function WagerFormModal({ onClose, onSaved, editWager }: Props) {
  const [step, setStep] = useState(editWager ? 2 : 1);
  const [kind, setKind] = useState<WagerKind>(editWager?.kind || 'odds');
  const [title, setTitle] = useState(editWager?.title || '');
  const [description, setDescription] = useState(editWager?.description || '');
  const [metric, setMetric] = useState<WagerMetric>(editWager?.metric || 'high_temp');
  const [targetDate, setTargetDate] = useState(editWager?.targetDate || '');
  const [lockTime, setLockTime] = useState(editWager?.lockTime?.slice(0, 16) || '');
  const [location, setLocation] = useState<GeoLocation | null>(
    editWager?.location ? { lat: editWager.location.lat, lon: editWager.location.lon, name: editWager.location.name } : null
  );

  // Odds
  const [outcomes, setOutcomes] = useState<OddsOutcome[]>(
    editWager?.outcomes || [
      { label: '', minValue: 0, maxValue: 0, odds: 100 },
      { label: '', minValue: 0, maxValue: 0, odds: 100 },
    ]
  );

  // Over/Under
  const [line, setLine] = useState<number>(editWager?.line ?? 0);
  const [overOdds, setOverOdds] = useState<number>(editWager?.over?.odds ?? -110);
  const [underOdds, setUnderOdds] = useState<number>(editWager?.under?.odds ?? -110);

  // Pointspread
  const [locationA, setLocationA] = useState<GeoLocation | null>(
    editWager?.locationA ? { lat: editWager.locationA.lat, lon: editWager.locationA.lon, name: editWager.locationA.name } : null
  );
  const [locationB, setLocationB] = useState<GeoLocation | null>(
    editWager?.locationB ? { lat: editWager.locationB.lat, lon: editWager.locationB.lon, name: editWager.locationB.name } : null
  );
  const [spread, setSpread] = useState<number>(editWager?.spread ?? 0);
  const [locationAOdds, setLocationAOdds] = useState<number>(editWager?.locationAOdds ?? -110);
  const [locationBOdds, setLocationBOdds] = useState<number>(editWager?.locationBOdds ?? -110);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');

    const base: any = {
      kind,
      title,
      description: description || undefined,
      metric,
      targetDate,
      lockTime: new Date(lockTime).toISOString(),
    };

    if (kind === 'odds') {
      base.location = location ? { name: location.name, lat: location.lat, lon: location.lon } : undefined;
      base.outcomes = outcomes;
    } else if (kind === 'over-under') {
      base.location = location ? { name: location.name, lat: location.lat, lon: location.lon } : undefined;
      base.line = line;
      base.over = { odds: overOdds } as OverUnderSide;
      base.under = { odds: underOdds } as OverUnderSide;
    } else {
      base.locationA = locationA ? { name: locationA.name, lat: locationA.lat, lon: locationA.lon } : undefined;
      base.locationB = locationB ? { name: locationB.name, lat: locationB.lat, lon: locationB.lon } : undefined;
      base.spread = spread;
      base.locationAOdds = locationAOdds;
      base.locationBOdds = locationBOdds;
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
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter((_, idx) => idx !== i));
  };

  const inputClass = 'w-full rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-sm text-text-dark outline-none focus:border-field focus:ring-2 focus:ring-field/20';
  const labelClass = 'mb-1 block text-sm font-medium text-text-dark-muted';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-xl border border-border-dark bg-surface-dark-alt p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-dark">
            {editWager ? 'Edit Wager' : 'Create Wager'}
          </h2>
          <button onClick={onClose} className="text-text-dark-muted hover:text-text-dark">&times;</button>
        </div>

        {/* Step indicators */}
        <div className="mb-6 flex gap-2">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-field' : 'bg-border-dark'}`}
            />
          ))}
        </div>

        {/* Step 1: Pick kind */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-text-dark-muted">Choose wager type:</p>
            {KINDS.map(k => (
              <button
                key={k.value}
                onClick={() => { setKind(k.value); setStep(2); }}
                className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                  kind === k.value
                    ? 'border-field bg-field/10'
                    : 'border-border-dark hover:border-field/50'
                }`}
              >
                <div className="font-semibold text-text-dark">{k.label}</div>
                <div className="text-xs text-text-dark-muted">{k.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Common fields */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="e.g. Seattle High Temp Tomorrow" />
            </div>
            <div>
              <label className={labelClass}>Description (optional)</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} className={inputClass} rows={2} placeholder="Optional context" />
            </div>

            {/* Location — single for odds/OU, dual for pointspread */}
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

            <div>
              <label className={labelClass}>Metric</label>
              <select value={metric} onChange={e => setMetric(e.target.value as WagerMetric)} className={inputClass} style={{ color: '#fff' }}>
                {METRICS.map(m => (
                  <option key={m.value} value={m.value} style={{ backgroundColor: '#0c2952', color: '#fff' }}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Target Date</label>
                <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Lock Time</label>
                <input type="datetime-local" value={lockTime} onChange={e => setLockTime(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="text-sm text-text-dark-muted hover:text-text-dark">
                &larr; Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white hover:bg-field-light"
              >
                Next &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Kind-specific fields */}
        {step === 3 && (
          <div className="space-y-4">
            {kind === 'odds' && (
              <>
                <p className="text-sm text-text-dark-muted">Define outcomes and American odds:</p>
                {outcomes.map((o, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className={labelClass}>Label</label>
                      <input value={o.label} onChange={e => updateOutcome(i, 'label', e.target.value)} className={inputClass} placeholder="60-62°F" />
                    </div>
                    <div className="w-20">
                      <label className={labelClass}>Min</label>
                      <input type="number" value={o.minValue} onChange={e => updateOutcome(i, 'minValue', +e.target.value)} className={inputClass} />
                    </div>
                    <div className="w-20">
                      <label className={labelClass}>Max</label>
                      <input type="number" value={o.maxValue} onChange={e => updateOutcome(i, 'maxValue', +e.target.value)} className={inputClass} />
                    </div>
                    <div className="w-24">
                      <label className={labelClass}>Odds</label>
                      <input type="number" value={o.odds} onChange={e => updateOutcome(i, 'odds', +e.target.value)} className={inputClass} placeholder="+135" />
                    </div>
                    {outcomes.length > 2 && (
                      <button onClick={() => removeOutcome(i)} className="mb-1 text-alert-light hover:text-alert" title="Remove">
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={addOutcome} className="text-sm text-field-light hover:underline">
                  + Add outcome
                </button>
              </>
            )}

            {kind === 'over-under' && (
              <>
                <div>
                  <label className={labelClass}>Line</label>
                  <input type="number" step="0.1" value={line} onChange={e => setLine(+e.target.value)} className={inputClass} placeholder="61" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Over Odds</label>
                    <input type="number" value={overOdds} onChange={e => setOverOdds(+e.target.value)} className={inputClass} placeholder="+120" />
                  </div>
                  <div>
                    <label className={labelClass}>Under Odds</label>
                    <input type="number" value={underOdds} onChange={e => setUnderOdds(+e.target.value)} className={inputClass} placeholder="-110" />
                  </div>
                </div>
              </>
            )}

            {kind === 'pointspread' && (
              <>
                <div>
                  <label className={labelClass}>Spread (A minus B)</label>
                  <input type="number" step="0.5" value={spread} onChange={e => setSpread(+e.target.value)} className={inputClass} placeholder="10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Location A Odds</label>
                    <input type="number" value={locationAOdds} onChange={e => setLocationAOdds(+e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Location B Odds</label>
                    <input type="number" value={locationBOdds} onChange={e => setLocationBOdds(+e.target.value)} className={inputClass} />
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="rounded-lg bg-alert/10 px-3 py-2 text-sm text-alert-light">{error}</div>
            )}

            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(2)} className="text-sm text-text-dark-muted hover:text-text-dark">
                &larr; Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-field px-6 py-2 text-sm font-semibold text-white hover:bg-field-light disabled:opacity-50"
              >
                {saving ? 'Saving...' : editWager ? 'Update Wager' : 'Create Wager'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
