import { useEffect, useState } from 'react';

export interface NWSStation {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  timeZone: string;
}

interface Props {
  lat: number | null;
  lon: number | null;
  /** Currently chosen stationId (the value used for grading). Pass undefined
   *  when the operator hasn't picked anything yet — the picker will
   *  default to the nearest station as soon as the list loads and call
   *  onChange with that selection so the form has a value to send. */
  value?: string;
  /** Fired with the full chosen station record so the parent can persist
   *  stationId, stationName, and timeZone on the wager. Called with null
   *  if the operator selects "auto (let server pick)". */
  onChange: (station: NWSStation | null) => void;
  /** Optional label for the surrounding wrapper. */
  label?: string;
  /** Tailwind class for the underlying select element. */
  inputClass: string;
  /** Inline style for native select (font color in light mode). */
  selectStyle?: React.CSSProperties;
  optionStyle?: React.CSSProperties;
}

export default function NWSStationPicker({
  lat,
  lon,
  value,
  onChange,
  label = 'NWS Grading Station',
  inputClass,
  selectStyle,
  optionStyle,
}: Props) {
  const [stations, setStations] = useState<NWSStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the input lat/lon changes, refetch the candidate stations
  // and default the selection to the nearest one (matches the legacy
  // auto-resolve behavior so existing wagers don't shift).
  useEffect(() => {
    if (lat == null || lon == null || lat === 0 || lon === 0) {
      setStations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/nws-stations?lat=${lat}&lon=${lon}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Failed to load stations');
          setStations([]);
          return;
        }
        const list: NWSStation[] = data.stations || [];
        setStations(list);
        // Auto-select the nearest if the parent didn't pre-set one
        // (or pre-set one we no longer have, e.g. after the user
        // changed the location).
        const stillValid = value && list.some((s) => s.stationId === value);
        if (!stillValid && list.length > 0) {
          onChange(list[0]);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || 'NWS station lookup failed');
          setStations([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // We intentionally only refetch when the coordinates change.
    // Including `value` would cause a refetch loop on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  const selected = stations.find((s) => s.stationId === value);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-500">
        {label}
      </label>
      {lat == null || lon == null || lat === 0 || lon === 0 ? (
        <p className="text-xs text-gray-500 italic">
          Pick a location above and the available NWS stations will appear here.
        </p>
      ) : loading ? (
        <p className="text-xs text-gray-500 italic">Loading nearby NWS stations…</p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : stations.length === 0 ? (
        <p className="text-xs text-orange-600">
          No NWS stations returned for that location. The server will fall back
          to auto-resolve at save time.
        </p>
      ) : (
        <>
          <select
            value={value || ''}
            onChange={(e) => {
              const pick = stations.find((s) => s.stationId === e.target.value);
              onChange(pick || null);
            }}
            className={inputClass}
            style={selectStyle}
          >
            {stations.map((s, i) => (
              <option key={s.stationId} value={s.stationId} style={optionStyle}>
                {i === 0 ? '★ ' : ''}
                {s.stationId} — {s.name} ({s.distanceMiles} mi away)
              </option>
            ))}
          </select>
          {selected && (
            <p className="mt-1 text-xs text-gray-600">
              Players will see: <span className="font-semibold">NWS station {selected.stationId} ({selected.name})</span>
              {' '}— {selected.distanceMiles} miles from the location you chose.
            </p>
          )}
        </>
      )}
    </div>
  );
}
