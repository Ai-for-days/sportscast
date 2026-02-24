import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DailyForecast, ForecastPoint } from '../../lib/types';

type MapMode = 'radar' | 'temperature' | 'precipitation' | 'wind' | 'gusts' | 'aqi';

interface Props {
  lat: number;
  lon: number;
  daily?: DailyForecast[];
  hourly?: ForecastPoint[];
}

// Consistent basemap — positron is the lightest CARTO style (near bone/off-white)
const BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';


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
  if (zoom <= 3) return 2;
  if (zoom <= 4) return 3;
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

      if (visible.length > 120) {
        visible = visible.slice(0, 120);
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
// RainViewer radar tiles (past) + Open-Meteo forecast canvas (future 8h)
// =============================================

type PrecipFrame =
  | { type: 'radar'; time: number; path: string }
  | { type: 'forecast'; time: number; hourIndex: number };

// Radar-style color mapping for precipitation intensity (mm/hr)
function precipColor(mm: number): [number, number, number, number] {
  if (mm < 0.1) return [0, 0, 0, 0];
  if (mm < 0.5) return [4, 233, 231, 100];     // light cyan
  if (mm < 1.5) return [0, 180, 255, 140];      // blue
  if (mm < 3.0) return [0, 200, 0, 155];        // green
  if (mm < 6.0) return [255, 230, 0, 170];      // yellow
  if (mm < 10.0) return [255, 140, 0, 180];     // orange
  if (mm < 20.0) return [255, 0, 0, 190];       // red
  return [180, 0, 255, 200];                     // purple
}

// Build a canvas image from grid precipitation data with bilinear interpolation
function renderPrecipCanvas(
  grid: number[][], // [row][col] precip values in mm
  rows: number,
  cols: number,
  size: number = 256,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = (px / (size - 1)) * (cols - 1);
      const gy = (py / (size - 1)) * (rows - 1);

      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, cols - 1);
      const y0 = Math.floor(gy);
      const y1 = Math.min(y0 + 1, rows - 1);
      const fx = gx - x0;
      const fy = gy - y0;

      const val =
        grid[y0][x0] * (1 - fx) * (1 - fy) +
        grid[y0][x1] * fx * (1 - fy) +
        grid[y1][x0] * (1 - fx) * fy +
        grid[y1][x1] * fx * fy;

      const [r, g, b, a] = precipColor(val);
      const idx = (py * size + px) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = a;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

const GRID_ROWS = 12;
const GRID_COLS = 12;
const LAT_RADIUS = 5;
const LON_RADIUS = 7;

function AnimatedPrecipLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);
  const [allFrames, setAllFrames] = useState<PrecipFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [host, setHost] = useState('https://tilecache.rainviewer.com');
  const [forecastImages, setForecastImages] = useState<Map<number, string>>(new Map());
  const [radarPastCount, setRadarPastCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Grid bounds for forecast overlay
  const bounds: L.LatLngBoundsExpression = [
    [lat - LAT_RADIUS, lon - LON_RADIUS],
    [lat + LAT_RADIUS, lon + LON_RADIUS],
  ];

  // 1) Fetch RainViewer radar (past 2h) + Open-Meteo forecast grid (next 8h)
  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const twoHoursAgo = nowSec - 2 * 60 * 60;

      // --- RainViewer past radar (trim to last 2 hours) ---
      let radarFrames: PrecipFrame[] = [];
      let rvHost = 'https://tilecache.rainviewer.com';
      let pastLen = 0;
      try {
        const rvRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (rvRes.ok) {
          const rvData = await rvRes.json();
          rvHost = rvData.host || rvHost;
          const allPast: PrecipFrame[] = (rvData.radar?.past ?? []).map((f: any): PrecipFrame => ({
            type: 'radar', time: f.time, path: f.path,
          }));
          // Only keep frames from the last 2 hours
          radarFrames = allPast.filter(f => f.time >= twoHoursAgo);
          pastLen = radarFrames.length;
        }
      } catch (err) {
        console.warn('RainViewer fetch failed:', err);
      }

      // --- Open-Meteo forecast grid (next 8 hours) ---
      const gridLats: number[] = [];
      const gridLons: number[] = [];
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          gridLats.push(Math.round(((lat + LAT_RADIUS) - r * (2 * LAT_RADIUS / (GRID_ROWS - 1))) * 100) / 100);
          gridLons.push(Math.round(((lon - LON_RADIUS) + c * (2 * LON_RADIUS / (GRID_COLS - 1))) * 100) / 100);
        }
      }

      let forecastFrames: PrecipFrame[] = [];
      const imgMap = new Map<number, string>();
      try {
        const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${gridLats.join(',')}&longitude=${gridLons.join(',')}&hourly=precipitation&forecast_hours=9`;
        const omRes = await fetch(omUrl);
        if (omRes.ok && !cancelled) {
          const omData = await omRes.json();
          const results = Array.isArray(omData) ? omData : [omData];

          const times: string[] = results[0]?.hourly?.time ?? [];

          // Open-Meteo returns UTC timestamps without 'Z' suffix — append it
          // so new Date() parses them as UTC instead of local browser time
          for (let h = 0; h < Math.min(times.length, 9); h++) {
            const grid: number[][] = [];
            for (let r = 0; r < GRID_ROWS; r++) {
              const row: number[] = [];
              for (let c = 0; c < GRID_COLS; c++) {
                const ptIdx = r * GRID_COLS + c;
                const precip = results[ptIdx]?.hourly?.precipitation?.[h] ?? 0;
                row.push(precip);
              }
              grid.push(row);
            }

            const frameTime = Math.floor(new Date(times[h] + 'Z').getTime() / 1000);
            const dataUrl = renderPrecipCanvas(grid, GRID_ROWS, GRID_COLS);
            imgMap.set(h, dataUrl);
            forecastFrames.push({ type: 'forecast', time: frameTime, hourIndex: h });
          }
        }
      } catch (err) {
        console.warn('Open-Meteo precip grid fetch failed:', err);
      }

      if (cancelled) return;

      // Remove forecast frames that overlap with radar times
      const lastRadarTime = radarFrames.length > 0
        ? radarFrames[radarFrames.length - 1].time
        : 0;
      forecastFrames = forecastFrames.filter(f => f.time > lastRadarTime);

      const combined = [...radarFrames, ...forecastFrames];
      setHost(rvHost);
      setRadarPastCount(pastLen);
      setAllFrames(combined);
      setForecastImages(imgMap);
      // Start at beginning (2 hours ago) and play forward through forecast
      setFrameIndex(0);
    };

    fetchAll();
    const refresh = setInterval(fetchAll, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(refresh); };
  }, [lat, lon]);

  // 2) Animation playback
  useEffect(() => {
    if (playing && allFrames.length > 0) {
      intervalRef.current = setInterval(() => {
        setFrameIndex(prev => (prev + 1) % allFrames.length);
      }, 700);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, allFrames.length]);

  // 3) Render the current frame (tile layer OR image overlay)
  useEffect(() => {
    // Clear previous layers
    if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }
    if (imageOverlayRef.current) { imageOverlayRef.current.remove(); imageOverlayRef.current = null; }

    if (allFrames.length === 0) return;
    const frame = allFrames[frameIndex];
    if (!frame) return;

    if (frame.type === 'radar') {
      const tileUrl = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
      tileLayerRef.current = L.tileLayer(tileUrl, { opacity: 0.75, zIndex: 10 });
      tileLayerRef.current.addTo(map);
    } else {
      const dataUrl = forecastImages.get(frame.hourIndex);
      if (dataUrl) {
        imageOverlayRef.current = L.imageOverlay(dataUrl, bounds, { opacity: 0.75, zIndex: 10 });
        imageOverlayRef.current.addTo(map);
      }
    }

    return () => {
      if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }
      if (imageOverlayRef.current) { imageOverlayRef.current.remove(); imageOverlayRef.current = null; }
    };
  }, [map, allFrames, frameIndex, host, forecastImages]);

  // Time label
  const currentFrame = allFrames[frameIndex];
  const timeLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : 'Loading...';

  const isForecast = currentFrame?.type === 'forecast';
  const isPast = currentFrame?.type === 'radar' && frameIndex < radarPastCount;

  return (
    <div className="absolute bottom-4 right-4 z-[1000] flex flex-col items-end gap-2">
      {/* Time label */}
      <div className="rounded-lg border border-border bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <span className="text-xs font-semibold text-text dark:text-text-dark">
          {timeLabel}
          {isForecast && <span className="ml-1.5 text-[10px] font-medium text-field">(Forecast)</span>}
          {!isPast && !isForecast && currentFrame && <span className="ml-1.5 text-[10px] font-medium text-sky-dark">(Nowcast)</span>}
        </span>
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
          max={Math.max(0, allFrames.length - 1)}
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
  // direction is meteorological (where wind comes FROM); +180 to show where it blows TO
  return `<svg width="80" height="80" viewBox="0 0 80 80" style="transform:rotate(${direction + 180}deg)">
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
    radar: {
      label: 'Radar Reflectivity (dBZ)',
      items: [
        { color: '#04e9e7', label: 'Light (5-20)' },
        { color: '#00c921', label: 'Moderate (20-35)' },
        { color: '#fecb00', label: 'Heavy (35-50)' },
        { color: '#ff0000', label: 'Intense (50-65)' },
        { color: '#c800d2', label: 'Extreme (65+)' },
      ],
    },
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
      label: 'Precipitation (Radar + 8h Forecast)',
      items: [
        { color: '#04e9e7', label: 'Light (< 0.5 mm)' },
        { color: '#00c800', label: 'Moderate (0.5-3 mm)' },
        { color: '#ffe600', label: 'Heavy (3-6 mm)' },
        { color: '#ff8c00', label: 'Very Heavy (6-10 mm)' },
        { color: '#ff0000', label: 'Intense (10+ mm)' },
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
  const [mode, setMode] = useState<MapMode>('radar');

  const tabs: { key: MapMode; label: string }[] = [
    { key: 'radar', label: 'Radar' },
    { key: 'temperature', label: 'Temp' },
    { key: 'precipitation', label: 'Precip' },
    { key: 'wind', label: 'Wind' },
    { key: 'gusts', label: 'Gusts' },
    { key: 'aqi', label: 'AQI' },
  ];

  const defaultZoom = mode === 'temperature' ? 5 : 7;

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

          {mode === 'radar' && (
            <TileLayer
              url="https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet</a> | NEXRAD'
              opacity={0.7}
            />
          )}
          {mode === 'temperature' && <TemperatureTownLayer lat={lat} lon={lon} />}
          {mode === 'precipitation' && <AnimatedPrecipLayer lat={lat} lon={lon} />}
          {mode === 'wind' && <WindArrowLayer lat={lat} lon={lon} />}
          {mode === 'gusts' && <GustArrowLayer lat={lat} lon={lon} />}
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
