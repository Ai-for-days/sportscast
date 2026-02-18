import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DailyForecast } from '../../lib/types';

type MapMode = 'temperature' | 'precipitation' | 'wind' | 'aqi';

interface Props {
  lat: number;
  lon: number;
  daily?: DailyForecast[];
}

// =============================================
// TEMPERATURE MAP — shows nearby town temps
// =============================================

interface TownTemp {
  name: string;
  lat: number;
  lon: number;
  tempF: number;
}

function getTierForZoom(zoom: number): number {
  if (zoom <= 5) return 1;
  if (zoom <= 7) return 2;
  if (zoom <= 9) return 3;
  return 4;
}

function TemperatureTownLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);
  const [towns, setTowns] = useState<TownTemp[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchKey = useRef('');

  const fetchTowns = useCallback(async () => {
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const maxTier = getTierForZoom(zoom);

    // Create a fetch key to avoid redundant fetches
    const key = `${bounds.getNorth().toFixed(1)},${bounds.getSouth().toFixed(1)},${bounds.getEast().toFixed(1)},${bounds.getWest().toFixed(1)},${maxTier}`;
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      // Dynamically import the cities list
      const { cities } = await import('../../lib/us-cities');

      // Filter cities within bounds and by tier
      const n = bounds.getNorth() + 0.5;
      const s = bounds.getSouth() - 0.5;
      const e = bounds.getEast() + 0.5;
      const w = bounds.getWest() - 0.5;

      let visible = cities.filter(c =>
        c.tier <= maxTier &&
        c.lat >= s && c.lat <= n &&
        c.lon >= w && c.lon <= e
      );

      // Limit to prevent too many API calls
      if (visible.length > 40) {
        visible = visible.slice(0, 40);
      }

      if (visible.length === 0) {
        setTowns([]);
        return;
      }

      // Fetch temps from Open-Meteo multi-point API
      const lats = visible.map(c => c.lat).join(',');
      const lons = visible.map(c => c.lon).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m&temperature_unit=fahrenheit`;

      const res = await fetch(url, { signal: abortRef.current!.signal });
      if (!res.ok) return;
      const data = await res.json();

      const results = Array.isArray(data) ? data : [data];
      const townTemps: TownTemp[] = visible.map((city, i) => ({
        name: city.name,
        lat: city.lat,
        lon: city.lon,
        tempF: Math.round(results[i]?.current?.temperature_2m ?? 0),
      }));

      setTowns(townTemps);
    } catch (err: any) {
      if (err.name !== 'AbortError') console.warn('Temp fetch failed:', err);
    }
  }, [map]);

  // Initial fetch and refetch on move/zoom
  useEffect(() => {
    fetchTowns();
  }, [fetchTowns]);

  useMapEvents({
    moveend: fetchTowns,
    zoomend: fetchTowns,
  });

  // Render markers
  useEffect(() => {
    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    towns.forEach(town => {
      const tempColor = town.tempF <= 32 ? '#a78bfa'
        : town.tempF <= 50 ? '#60a5fa'
        : town.tempF <= 65 ? '#34d399'
        : town.tempF <= 80 ? '#fbbf24'
        : town.tempF <= 95 ? '#f97316'
        : '#ef4444';

      const icon = L.divIcon({
        className: 'temp-label',
        html: `<div style="
          display:flex;flex-direction:column;align-items:center;gap:1px;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif;
          pointer-events:none;transform:translateX(-50%);
        ">
          <span style="font-size:15px;font-weight:700;color:${tempColor};
            text-shadow:0 1px 3px rgba(0,0,0,0.8),0 0px 1px rgba(0,0,0,0.9);">
            ${town.tempF}°
          </span>
          <span style="font-size:10px;color:#e2e8f0;font-weight:500;
            text-shadow:0 1px 2px rgba(0,0,0,0.9);">
            ${town.name}
          </span>
        </div>`,
        iconSize: [80, 36],
        iconAnchor: [40, 18],
      });

      const marker = L.marker([town.lat, town.lon], { icon, interactive: false });
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
    };
  }, [map, towns]);

  return null;
}


// =============================================
// PRECIPITATION MAP — basic precip + 15-day timeline
// =============================================

function PrecipOverlay() {
  return (
    <TileLayer
      url="https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=9de243494c0b295cca9337e1e96b00e2"
      opacity={0.5}
      zIndex={10}
    />
  );
}

function PrecipTimeline({ daily }: { daily: DailyForecast[] }) {
  if (!daily || daily.length === 0) return null;

  const maxPrecip = Math.max(...daily.map(d => d.precipMm), 1);

  return (
    <div className="border-t border-border px-3 py-3 dark:border-border-dark">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
        15-Day Precipitation Forecast
      </div>
      <div className="flex items-end gap-[3px]">
        {daily.map((day, i) => {
          const pct = Math.max(4, (day.precipMm / maxPrecip) * 100);
          const d = new Date(day.date);
          const dayLabel = d.toLocaleDateString('en-US', { weekday: 'narrow' });
          const dateLabel = d.getDate();
          const hasRain = day.precipMm > 0;
          const barColor = day.precipProbability >= 70 ? '#3b82f6'
            : day.precipProbability >= 40 ? '#60a5fa'
            : day.precipProbability > 0 ? '#93c5fd'
            : '#e2e8f0';

          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-0.5" title={`${day.date}: ${day.precipMm}mm, ${day.precipProbability}%`}>
              <span className="text-[8px] text-text-muted dark:text-text-dark-muted">
                {hasRain ? `${day.precipProbability}%` : ''}
              </span>
              <div className="w-full rounded-t-sm" style={{
                height: `${pct * 0.5}px`,
                minHeight: '2px',
                backgroundColor: barColor,
              }} />
              <span className="text-[9px] font-medium text-text-muted dark:text-text-dark-muted">{dayLabel}</span>
              <span className="text-[8px] text-text-muted/60 dark:text-text-dark-muted/60">{dateLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// =============================================
// WIND MAP — OWM wind tiles
// =============================================

function WindTileLayer() {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const layer = L.tileLayer(
      'https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=9de243494c0b295cca9337e1e96b00e2',
      { opacity: 0.5, zIndex: 10 }
    );
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [map]);

  return null;
}


// =============================================
// AQI MAP — colored circle markers
// =============================================

function AQIOverlay({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    const fetchAQI = async () => {
      const step = 1.5;
      const lats: number[] = [];
      const lons: number[] = [];
      for (let la = lat - 5; la <= lat + 5; la += step) {
        for (let lo = lon - 8; lo <= lon + 8; lo += step) {
          lats.push(la);
          lons.push(lo);
        }
      }

      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=us_aqi`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        results.forEach((r: any) => {
          const aqi = r.current?.us_aqi ?? 0;
          let color = '#22c55e';
          if (aqi > 300) color = '#7f1d1d';
          else if (aqi > 200) color = '#7c3aed';
          else if (aqi > 150) color = '#ef4444';
          else if (aqi > 100) color = '#f97316';
          else if (aqi > 50) color = '#eab308';

          const marker = L.circleMarker([r.latitude, r.longitude], {
            radius: 18,
            fillColor: color,
            color: 'transparent',
            fillOpacity: 0.35,
          }).bindTooltip(`AQI: ${aqi}`, { direction: 'top' });
          marker.addTo(map);
          markersRef.current.push(marker);
        });
      } catch {}
    };

    fetchAQI();
    return () => { markersRef.current.forEach(m => m.remove()); };
  }, [map, lat, lon]);

  return null;
}


// =============================================
// LEGENDS
// =============================================

function MapLegend({ mode }: { mode: MapMode }) {
  const configs: Record<MapMode, { label: string; items: { color: string; label: string }[] }> = {
    temperature: {
      label: 'Temperature (°F)',
      items: [
        { color: '#a78bfa', label: '< 32°' },
        { color: '#60a5fa', label: '32-50°' },
        { color: '#34d399', label: '50-65°' },
        { color: '#fbbf24', label: '65-80°' },
        { color: '#f97316', label: '80-95°' },
        { color: '#ef4444', label: '95°+' },
      ],
    },
    precipitation: {
      label: 'Precipitation',
      items: [
        { color: '#a3d9ff', label: 'Light' },
        { color: '#4a90d9', label: 'Moderate' },
        { color: '#ffd700', label: 'Heavy' },
        { color: '#ff4500', label: 'Intense' },
      ],
    },
    wind: {
      label: 'Wind Speed (mph)',
      items: [
        { color: '#c4e6c3', label: '< 10' },
        { color: '#4dac26', label: '10-20' },
        { color: '#f4a582', label: '20-30' },
        { color: '#d6604d', label: '30+' },
      ],
    },
    aqi: {
      label: 'Air Quality Index',
      items: [
        { color: '#22c55e', label: 'Good (0-50)' },
        { color: '#eab308', label: 'Moderate (51-100)' },
        { color: '#f97316', label: 'Sensitive (101-150)' },
        { color: '#ef4444', label: 'Unhealthy (151+)' },
      ],
    },
  };

  const cfg = configs[mode];

  return (
    <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-text dark:text-text-dark">{cfg.label}</div>
      <div className="space-y-1">
        {cfg.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px] text-text-muted dark:text-text-dark-muted">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}


// =============================================
// CENTER MARKER
// =============================================

function CenterMarker({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();

  useEffect(() => {
    const icon = L.divIcon({
      className: 'center-pin',
      html: `<div style="width:14px;height:14px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([lat, lon], { icon }).addTo(map);
    return () => { marker.remove(); };
  }, [map, lat, lon]);

  return null;
}


// =============================================
// MAIN COMPONENT
// =============================================

export default function ForecastMaps({ lat, lon, daily }: Props) {
  const [mode, setMode] = useState<MapMode>('temperature');

  const tabs: { key: MapMode; label: string }[] = [
    { key: 'temperature', label: 'Temp' },
    { key: 'precipitation', label: 'Precip' },
    { key: 'wind', label: 'Wind' },
    { key: 'aqi', label: 'AQI' },
  ];

  const defaultZoom = mode === 'temperature' ? 8 : 7;

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-border-dark">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setMode(tab.key)}
            className={`flex-1 px-3 py-3 text-xs font-semibold transition-colors ${
              mode === tab.key
                ? 'border-b-2 border-field text-field'
                : 'text-text-muted hover:text-text dark:text-text-dark-muted dark:hover:text-text-dark'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="relative h-[350px] sm:h-[400px]">
        <MapContainer
          key={mode}
          center={[lat, lon]}
          zoom={defaultZoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url={mode === 'temperature'
              ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
              : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            }
          />

          {mode === 'temperature' && <TemperatureTownLayer lat={lat} lon={lon} />}
          {mode === 'precipitation' && <PrecipOverlay />}
          {mode === 'wind' && <WindTileLayer />}
          {mode === 'aqi' && <AQIOverlay lat={lat} lon={lon} />}

          <CenterMarker lat={lat} lon={lon} />
        </MapContainer>

        {mode !== 'temperature' && <MapLegend mode={mode} />}
      </div>

      {/* Precip 15-day timeline */}
      {mode === 'precipitation' && daily && <PrecipTimeline daily={daily} />}
    </div>
  );
}
