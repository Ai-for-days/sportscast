import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DailyForecast, ForecastPoint } from '../../lib/types';

type MapMode = 'temperature' | 'precipitation' | 'wind' | 'gusts' | 'aqi';

interface Props {
  lat: number;
  lon: number;
  daily?: DailyForecast[];
  hourly?: ForecastPoint[];
}

// Consistent basemap for all tabs — voyager is visible/readable with colored overlays
const BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/voyager_nolabels/{z}/{x}/{y}{r}.png';


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
  if (zoom <= 4) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 7) return 4;
  return 5;
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

    const key = `${bounds.getNorth().toFixed(1)},${bounds.getSouth().toFixed(1)},${bounds.getEast().toFixed(1)},${bounds.getWest().toFixed(1)},${maxTier}`;
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      const { cities } = await import('../../lib/us-cities');

      const n = bounds.getNorth() + 0.5;
      const s = bounds.getSouth() - 0.5;
      const e = bounds.getEast() + 0.5;
      const w = bounds.getWest() - 0.5;

      let visible = cities.filter(c =>
        c.tier <= maxTier &&
        c.lat >= s && c.lat <= n &&
        c.lon >= w && c.lon <= e
      );

      if (visible.length > 80) {
        visible = visible.slice(0, 80);
      }

      if (visible.length === 0) {
        setTowns([]);
        return;
      }

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

  useEffect(() => {
    fetchTowns();
  }, [fetchTowns]);

  useMapEvents({
    moveend: fetchTowns,
    zoomend: fetchTowns,
  });

  useEffect(() => {
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
            text-shadow:0 0 4px rgba(255,255,255,0.9),0 1px 3px rgba(0,0,0,0.6);">
            ${town.tempF}°
          </span>
          <span style="font-size:10px;color:#334155;font-weight:600;
            text-shadow:0 0 3px rgba(255,255,255,0.9);">
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
// ANIMATED PRECIPITATION MAP
// =============================================

interface PrecipGridPoint {
  lat: number;
  lon: number;
  hours: { time: string; precip: number; cloudCover: number }[];
}

function AnimatedPrecipLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);
  const labelsRef = useRef<L.Marker[]>([]);
  const [gridData, setGridData] = useState<PrecipGridPoint[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build a 5x5 grid around the center
  const gridPoints = useRef<{ lat: number; lon: number }[]>([]);
  if (gridPoints.current.length === 0) {
    const latStep = 2.0;
    const lonStep = 2.5;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        gridPoints.current.push({
          lat: Math.round((lat + r * latStep) * 100) / 100,
          lon: Math.round((lon + c * lonStep) * 100) / 100,
        });
      }
    }
  }

  // Total frames: 15 days * 4 (6-hour intervals) = 60 frames
  const totalFrames = 56;

  useEffect(() => {
    const fetchPrecip = async () => {
      try {
        const lats = gridPoints.current.map(p => p.lat).join(',');
        const lons = gridPoints.current.map(p => p.lon).join(',');
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation,cloud_cover&precipitation_unit=inch&forecast_days=15`;

        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        const results = Array.isArray(data) ? data : [data];
        const points: PrecipGridPoint[] = gridPoints.current.map((pt, i) => {
          const r = results[i];
          const times: string[] = r?.hourly?.time ?? [];
          const precip: number[] = r?.hourly?.precipitation ?? [];
          const cloud: number[] = r?.hourly?.cloud_cover ?? [];

          // Sample every 6 hours
          const hours: PrecipGridPoint['hours'] = [];
          for (let h = 0; h < times.length; h += 6) {
            // Sum precip over 6-hour window
            let precipSum = 0;
            let cloudAvg = 0;
            const count = Math.min(6, times.length - h);
            for (let j = 0; j < count; j++) {
              precipSum += precip[h + j] ?? 0;
              cloudAvg += cloud[h + j] ?? 0;
            }
            cloudAvg /= count;
            hours.push({
              time: times[h],
              precip: Math.round(precipSum * 100) / 100,
              cloudCover: Math.round(cloudAvg),
            });
          }
          return { lat: pt.lat, lon: pt.lon, hours };
        });

        setGridData(points);
      } catch (err) {
        console.warn('Precip grid fetch failed:', err);
      }
    };

    fetchPrecip();
  }, [lat, lon]);

  // Animation playback
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setFrameIndex(prev => (prev + 1) % totalFrames);
      }, 500);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing]);

  // Render markers for current frame
  useEffect(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    labelsRef.current.forEach(m => m.remove());
    labelsRef.current = [];

    if (gridData.length === 0) return;

    gridData.forEach(pt => {
      const frame = pt.hours[frameIndex];
      if (!frame) return;

      // Cloud cover circle (gray)
      if (frame.cloudCover > 10) {
        const cloudOpacity = Math.min(0.4, (frame.cloudCover / 100) * 0.45);
        const cloudRadius = 15 + (frame.cloudCover / 100) * 20;
        const cloud = L.circleMarker([pt.lat, pt.lon], {
          radius: cloudRadius,
          fillColor: '#94a3b8',
          color: 'transparent',
          fillOpacity: cloudOpacity,
          interactive: false,
        });
        cloud.addTo(map);
        markersRef.current.push(cloud);
      }

      // Precipitation circle (blue)
      if (frame.precip > 0.01) {
        const precipRadius = Math.min(25, 6 + frame.precip * 15);
        const precipOpacity = Math.min(0.7, 0.3 + frame.precip * 0.3);
        const circle = L.circleMarker([pt.lat, pt.lon], {
          radius: precipRadius,
          fillColor: '#3b82f6',
          color: '#2563eb',
          weight: 1,
          fillOpacity: precipOpacity,
          interactive: false,
        });
        circle.addTo(map);
        markersRef.current.push(circle);

        // Label with inches
        const label = L.marker([pt.lat, pt.lon], {
          icon: L.divIcon({
            className: 'precip-label',
            html: `<div style="
              font-size:11px;font-weight:700;color:#1e40af;
              text-shadow:0 0 4px rgba(255,255,255,0.9);
              pointer-events:none;text-align:center;
            ">${frame.precip.toFixed(2)}"</div>`,
            iconSize: [50, 16],
            iconAnchor: [25, 8],
          }),
          interactive: false,
        });
        label.addTo(map);
        labelsRef.current.push(label);
      }
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      labelsRef.current.forEach(m => m.remove());
      labelsRef.current = [];
    };
  }, [map, gridData, frameIndex]);

  // Get current frame time label
  const currentTime = gridData[0]?.hours[frameIndex]?.time ?? '';
  const timeLabel = currentTime
    ? new Date(currentTime).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', hour12: true,
      })
    : '';

  return (
    <div className="absolute bottom-4 right-4 z-[1000] flex flex-col items-end gap-2">
      {/* Time label */}
      <div className="rounded-lg border border-border bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <span className="text-xs font-semibold text-text dark:text-text-dark">{timeLabel}</span>
      </div>
      {/* Controls */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <button
          onClick={() => setPlaying(!playing)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-field text-white text-xs"
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={frameIndex}
          onChange={e => { setPlaying(false); setFrameIndex(Number(e.target.value)); }}
          className="w-28 sm:w-40"
        />
      </div>
    </div>
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
          const [y, mo, da] = day.date.split('-').map(Number);
          const d = new Date(Date.UTC(y, mo - 1, da));
          const dayLabel = ['S','M','T','W','T','F','S'][d.getUTCDay()];
          const dateLabel = da;
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
// WIND ARROW MAP
// =============================================

function windSpeedColor(speed: number): string {
  if (speed < 10) return '#22c55e';
  if (speed < 20) return '#eab308';
  if (speed < 30) return '#f97316';
  return '#ef4444';
}

function arrowSvg(speed: number, direction: number, color: string): string {
  const length = Math.min(75, Math.max(15, speed * 2.5));
  const headSize = 6;
  return `<svg width="80" height="80" viewBox="0 0 80 80" style="transform:rotate(${direction}deg)">
    <line x1="40" y1="${40 + length / 2}" x2="40" y2="${40 - length / 2}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
    <polygon points="${40},${40 - length / 2} ${40 - headSize},${40 - length / 2 + headSize * 1.5} ${40 + headSize},${40 - length / 2 + headSize * 1.5}" fill="${color}"/>
  </svg>`;
}

function WindArrowLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    const fetchWind = async () => {
      // 6x5 grid
      const lats: number[] = [];
      const lons: number[] = [];
      const latStep = 2.0;
      const lonStep = 2.5;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2.5; c <= 2.5; c++) {
          lats.push(Math.round((lat + r * latStep) * 100) / 100);
          lons.push(Math.round((lon + c * lonStep) * 100) / 100);
        }
      }

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=mph`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        results.forEach((r: any, i: number) => {
          const speed = r.current?.wind_speed_10m ?? 0;
          const dir = r.current?.wind_direction_10m ?? 0;
          const color = windSpeedColor(speed);

          const icon = L.divIcon({
            className: 'wind-arrow',
            html: `<div style="position:relative;width:80px;height:80px;">
              ${arrowSvg(speed, dir, color)}
              <div style="position:absolute;bottom:0;left:0;right:0;text-align:center;
                font-size:10px;font-weight:700;color:${color};
                text-shadow:0 0 4px rgba(255,255,255,0.9),0 1px 2px rgba(0,0,0,0.4);">
                ${Math.round(speed)} mph
              </div>
            </div>`,
            iconSize: [80, 80],
            iconAnchor: [40, 40],
          });

          const marker = L.marker([lats[i], lons[i]], { icon, interactive: false });
          marker.addTo(map);
          markersRef.current.push(marker);
        });
      } catch (err) {
        console.warn('Wind fetch failed:', err);
      }
    };

    fetchWind();
    return () => { markersRef.current.forEach(m => m.remove()); };
  }, [map, lat, lon]);

  return null;
}


// =============================================
// GUST ARROW MAP
// =============================================

function gustSpeedColor(speed: number): string {
  if (speed < 15) return '#60a5fa';
  if (speed < 25) return '#818cf8';
  if (speed < 40) return '#a855f7';
  return '#c026d3';
}

function GustArrowLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    const fetchGusts = async () => {
      const lats: number[] = [];
      const lons: number[] = [];
      const latStep = 2.0;
      const lonStep = 2.5;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2.5; c <= 2.5; c++) {
          lats.push(Math.round((lat + r * latStep) * 100) / 100);
          lons.push(Math.round((lon + c * lonStep) * 100) / 100);
        }
      }

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_gusts_10m,wind_direction_10m&wind_speed_unit=mph`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];

        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        results.forEach((r: any, i: number) => {
          const gust = r.current?.wind_gusts_10m ?? 0;
          const dir = r.current?.wind_direction_10m ?? 0;
          const color = gustSpeedColor(gust);

          const icon = L.divIcon({
            className: 'gust-arrow',
            html: `<div style="position:relative;width:80px;height:80px;">
              ${arrowSvg(gust, dir, color)}
              <div style="position:absolute;bottom:0;left:0;right:0;text-align:center;
                font-size:10px;font-weight:700;color:${color};
                text-shadow:0 0 4px rgba(255,255,255,0.9),0 1px 2px rgba(0,0,0,0.4);">
                ${Math.round(gust)} mph
              </div>
            </div>`,
            iconSize: [80, 80],
            iconAnchor: [40, 40],
          });

          const marker = L.marker([lats[i], lons[i]], { icon, interactive: false });
          marker.addTo(map);
          markersRef.current.push(marker);
        });
      } catch (err) {
        console.warn('Gust fetch failed:', err);
      }
    };

    fetchGusts();
    return () => { markersRef.current.forEach(m => m.remove()); };
  }, [map, lat, lon]);

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
        { color: '#94a3b8', label: 'Cloud cover' },
        { color: '#3b82f6', label: 'Rain/snow' },
      ],
    },
    wind: {
      label: 'Wind Speed (mph)',
      items: [
        { color: '#22c55e', label: '< 10' },
        { color: '#eab308', label: '10-20' },
        { color: '#f97316', label: '20-30' },
        { color: '#ef4444', label: '30+' },
      ],
    },
    gusts: {
      label: 'Wind Gusts (mph)',
      items: [
        { color: '#60a5fa', label: '< 15' },
        { color: '#818cf8', label: '15-25' },
        { color: '#a855f7', label: '25-40' },
        { color: '#c026d3', label: '40+' },
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

export default function ForecastMaps({ lat, lon, daily, hourly }: Props) {
  const [mode, setMode] = useState<MapMode>('temperature');

  const tabs: { key: MapMode; label: string }[] = [
    { key: 'temperature', label: 'Temp' },
    { key: 'precipitation', label: 'Precip' },
    { key: 'wind', label: 'Wind' },
    { key: 'gusts', label: 'Gusts' },
    { key: 'aqi', label: 'AQI' },
  ];

  const defaultZoom = mode === 'temperature' ? 6 : 7;

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
            url={BASEMAP_URL}
          />

          {mode === 'temperature' && <TemperatureTownLayer lat={lat} lon={lon} />}
          {mode === 'precipitation' && <AnimatedPrecipLayer lat={lat} lon={lon} />}
          {mode === 'wind' && <WindArrowLayer lat={lat} lon={lon} />}
          {mode === 'gusts' && <GustArrowLayer lat={lat} lon={lon} />}
          {mode === 'aqi' && <AQIOverlay lat={lat} lon={lon} />}

          <CenterMarker lat={lat} lon={lon} />
        </MapContainer>

        {mode !== 'temperature' && mode !== 'precipitation' && <MapLegend mode={mode} />}
        {mode === 'precipitation' && <MapLegend mode={mode} />}
      </div>

      {/* Precip 15-day timeline */}
      {mode === 'precipitation' && daily && <PrecipTimeline daily={daily} />}
    </div>
  );
}
