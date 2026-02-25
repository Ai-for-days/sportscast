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
  if (zoom <= 3) return 1;
  if (zoom <= 4) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 6) return 4;
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

      if (visible.length > 300) {
        visible = visible.slice(0, 300);
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

interface RadarFrame {
  time: number;
  path: string;
}

function AnimatedPrecipLayer({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [allFrames, setAllFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [host, setHost] = useState('https://tilecache.rainviewer.com');
  const [radarPastCount, setRadarPastCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch RainViewer radar (past 2h + nowcast)
  useEffect(() => {
    let cancelled = false;

    const fetchRadar = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const twoHoursAgo = nowSec - 2 * 60 * 60;

      let frames: RadarFrame[] = [];
      let rvHost = 'https://tilecache.rainviewer.com';
      let pastLen = 0;
      try {
        const rvRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (rvRes.ok) {
          const rvData = await rvRes.json();
          rvHost = rvData.host || rvHost;

          const pastFrames: RadarFrame[] = (rvData.radar?.past ?? [])
            .map((f: any): RadarFrame => ({ time: f.time, path: f.path }))
            .filter((f: RadarFrame) => f.time >= twoHoursAgo);
          pastLen = pastFrames.length;

          const nowcastFrames: RadarFrame[] = (rvData.radar?.nowcast ?? [])
            .map((f: any): RadarFrame => ({ time: f.time, path: f.path }));

          frames = [...pastFrames, ...nowcastFrames];
        }
      } catch (err) {
        console.warn('RainViewer fetch failed:', err);
      }

      if (cancelled) return;

      setHost(rvHost);
      setRadarPastCount(pastLen);
      setAllFrames(frames);
      setFrameIndex(0);
    };

    fetchRadar();
    const refresh = setInterval(fetchRadar, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(refresh); };
  }, [lat, lon]);

  // Animation playback
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

  // Render the current radar frame
  useEffect(() => {
    if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }

    if (allFrames.length === 0) return;
    const frame = allFrames[frameIndex];
    if (!frame) return;

    const tileUrl = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    tileLayerRef.current = L.tileLayer(tileUrl, { opacity: 0.75, zIndex: 10 });
    tileLayerRef.current.addTo(map);

    return () => {
      if (tileLayerRef.current) { tileLayerRef.current.remove(); tileLayerRef.current = null; }
    };
  }, [map, allFrames, frameIndex, host]);

  // Time label
  const currentFrame = allFrames[frameIndex];
  const timeLabel = currentFrame
    ? new Date(currentFrame.time * 1000).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : 'Loading...';

  const isPast = frameIndex < radarPastCount;

  return (
    <div className="absolute bottom-4 right-4 z-[1000] flex flex-col items-end gap-2">
      {/* Time label */}
      <div className="rounded-lg border border-border bg-surface/95 px-3 py-1.5 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <span className="text-xs font-semibold text-text dark:text-text-dark">
          {timeLabel}
          {!isPast && currentFrame && <span className="ml-1.5 text-[10px] font-medium text-sky-dark">(Nowcast)</span>}
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
// WIND / GUST — iKitesurf-style heatmap + markers
// =============================================

/** Smooth wind speed → color with linear interpolation between stops. */
function windSpeedColor(speed: number): string {
  const stops: [number, number, number, number][] = [
    [0,  134, 239, 172],   // #86efac  calm
    [5,   34, 197,  94],   // #22c55e  light
    [10, 163, 230,  53],   // #a3e635  moderate
    [15, 234, 179,   8],   // #eab308  moderate-fresh
    [20, 249, 115,  22],   // #f97316  fresh
    [25, 239,  68,  68],   // #ef4444  strong
    [35, 220,  38,  38],   // #dc2626  gale
  ];
  if (speed <= 0) return `rgb(${stops[0][1]},${stops[0][2]},${stops[0][3]})`;
  for (let i = 1; i < stops.length; i++) {
    if (speed <= stops[i][0]) {
      const t = (speed - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const r = Math.round(stops[i - 1][1] + t * (stops[i][1] - stops[i - 1][1]));
      const g = Math.round(stops[i - 1][2] + t * (stops[i][2] - stops[i - 1][2]));
      const b = Math.round(stops[i - 1][3] + t * (stops[i][3] - stops[i - 1][3]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = stops[stops.length - 1];
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

/** RGB tuple version for canvas pixel rendering. */
function windSpeedRGB(speed: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0,  134, 239, 172],
    [5,   34, 197,  94],
    [10, 163, 230,  53],
    [15, 234, 179,   8],
    [20, 249, 115,  22],
    [25, 239,  68,  68],
    [35, 220,  38,  38],
  ];
  if (speed <= 0) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let i = 1; i < stops.length; i++) {
    if (speed <= stops[i][0]) {
      const t = (speed - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return [
        Math.round(stops[i - 1][1] + t * (stops[i][1] - stops[i - 1][1])),
        Math.round(stops[i - 1][2] + t * (stops[i][2] - stops[i - 1][2])),
        Math.round(stops[i - 1][3] + t * (stops[i][3] - stops[i - 1][3])),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

function gustSpeedColor(speed: number): string {
  const stops: [number, number, number, number][] = [
    [0,  147, 197, 253],   // #93c5fd
    [10,  96, 165, 250],   // #60a5fa
    [15, 129, 140, 248],   // #818cf8
    [20, 168,  85, 247],   // #a855f7
    [30, 192,  38, 211],   // #c026d3
    [40, 225,  29,  72],   // #e11d48
  ];
  if (speed <= 0) return `rgb(${stops[0][1]},${stops[0][2]},${stops[0][3]})`;
  for (let i = 1; i < stops.length; i++) {
    if (speed <= stops[i][0]) {
      const t = (speed - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const r = Math.round(stops[i - 1][1] + t * (stops[i][1] - stops[i - 1][1]));
      const g = Math.round(stops[i - 1][2] + t * (stops[i][2] - stops[i - 1][2]));
      const b = Math.round(stops[i - 1][3] + t * (stops[i][3] - stops[i - 1][3]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = stops[stops.length - 1];
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

function gustSpeedRGB(speed: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0,  147, 197, 253],
    [10,  96, 165, 250],
    [15, 129, 140, 248],
    [20, 168,  85, 247],
    [30, 192,  38, 211],
    [40, 225,  29,  72],
  ];
  if (speed <= 0) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let i = 1; i < stops.length; i++) {
    if (speed <= stops[i][0]) {
      const t = (speed - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return [
        Math.round(stops[i - 1][1] + t * (stops[i][1] - stops[i - 1][1])),
        Math.round(stops[i - 1][2] + t * (stops[i][2] - stops[i - 1][2])),
        Math.round(stops[i - 1][3] + t * (stops[i][3] - stops[i - 1][3])),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

function windDirLabel(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Simplified barb SVG — thin white arrow with dark outline + speed label. */
function barbSvg(speed: number, direction: number, size: number = 48): string {
  const half = size / 2;
  const len = size * 0.38;
  const head = Math.max(3, size * 0.14);
  // direction is meteorological (where wind comes FROM); +180 to show where it blows TO
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(${direction + 180}deg)">
    <line x1="${half}" y1="${half + len / 2}" x2="${half}" y2="${half - len / 2}"
      stroke="#1e293b" stroke-width="3.5" stroke-linecap="round"/>
    <polygon points="${half},${half - len / 2} ${half - head},${half - len / 2 + head * 1.4} ${half + head},${half - len / 2 + head * 1.4}"
      fill="#1e293b"/>
    <line x1="${half}" y1="${half + len / 2}" x2="${half}" y2="${half - len / 2}"
      stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>
    <polygon points="${half},${half - len / 2} ${half - head + 1},${half - len / 2 + head * 1.4} ${half + head - 1},${half - len / 2 + head * 1.4}"
      fill="#ffffff"/>
  </svg>`;
}

/** Compute grid step for heatmap (denser) and markers (sparser). */
function heatmapGridStep(zoom: number): { latStep: number; lonStep: number } {
  if (zoom >= 10) return { latStep: 0.06, lonStep: 0.075 };
  if (zoom >= 9) return { latStep: 0.12, lonStep: 0.15 };
  if (zoom >= 8) return { latStep: 0.2, lonStep: 0.25 };
  if (zoom >= 7) return { latStep: 0.35, lonStep: 0.42 };
  if (zoom >= 6) return { latStep: 0.65, lonStep: 0.8 };
  return { latStep: 1.2, lonStep: 1.5 };
}

function markerGridStep(zoom: number): { latStep: number; lonStep: number } {
  if (zoom >= 10) return { latStep: 0.18, lonStep: 0.22 };
  if (zoom >= 9) return { latStep: 0.3, lonStep: 0.36 };
  if (zoom >= 8) return { latStep: 0.5, lonStep: 0.6 };
  if (zoom >= 7) return { latStep: 0.8, lonStep: 1.0 };
  if (zoom >= 6) return { latStep: 1.5, lonStep: 1.8 };
  return { latStep: 2.5, lonStep: 3.0 };
}

/** Grid data point with speed, direction, gust. */
interface WindGridPoint {
  lat: number;
  lon: number;
  speed: number;
  gust: number;
  dir: number;
}

/**
 * Canvas heatmap layer — renders bilinear-interpolated color fill under the map tiles.
 * Shared between wind and gust modes via the colorFn prop.
 */
function WindHeatmapCanvas({
  grid,
  colorFn,
  valueKey,
}: {
  grid: WindGridPoint[];
  colorFn: (speed: number) => [number, number, number];
  valueKey: 'speed' | 'gust';
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Create canvas element once, attached to the map pane
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '250';
    canvas.style.opacity = '0.5';
    map.getPane('overlayPane')!.appendChild(canvas);
    canvasRef.current = canvas;
    return () => { canvas.remove(); canvasRef.current = null; };
  }, [map]);

  // Redraw heatmap whenever grid data changes or map moves
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || grid.length === 0) return;

    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;

    // Position canvas to cover the map container
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, topLeft);

    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(size.x, size.y);
    const pixels = imgData.data;

    // Build a lookup grid for bilinear interpolation
    const latSet = [...new Set(grid.map(p => p.lat))].sort((a, b) => a - b);
    const lonSet = [...new Set(grid.map(p => p.lon))].sort((a, b) => a - b);
    const gridMap = new Map<string, WindGridPoint>();
    for (const p of grid) gridMap.set(`${p.lat},${p.lon}`, p);

    // For each canvas pixel, find surrounding grid points and bilinear interpolate
    const STEP = 4; // render every 4th pixel for performance, then fill block
    for (let py = 0; py < size.y; py += STEP) {
      for (let px = 0; px < size.x; px += STEP) {
        const latlng = map.containerPointToLatLng([px + STEP / 2, py + STEP / 2]);
        const lat = latlng.lat;
        const lon = latlng.lng;

        // Find bounding grid indices
        let li = 0;
        for (let i = 0; i < latSet.length - 1; i++) {
          if (latSet[i + 1] >= lat) { li = i; break; }
          li = i;
        }
        let lj = 0;
        for (let j = 0; j < lonSet.length - 1; j++) {
          if (lonSet[j + 1] >= lon) { lj = j; break; }
          lj = j;
        }

        const lat0 = latSet[li];
        const lat1 = latSet[Math.min(li + 1, latSet.length - 1)];
        const lon0 = lonSet[lj];
        const lon1 = lonSet[Math.min(lj + 1, lonSet.length - 1)];

        const get = (la: number, lo: number) => {
          const p = gridMap.get(`${la},${lo}`);
          return p ? (valueKey === 'gust' ? p.gust : p.speed) : 0;
        };

        const v00 = get(lat0, lon0);
        const v10 = get(lat1, lon0);
        const v01 = get(lat0, lon1);
        const v11 = get(lat1, lon1);

        const tLat = lat1 !== lat0 ? (lat - lat0) / (lat1 - lat0) : 0;
        const tLon = lon1 !== lon0 ? (lon - lon0) / (lon1 - lon0) : 0;

        const value =
          v00 * (1 - tLat) * (1 - tLon) +
          v10 * tLat * (1 - tLon) +
          v01 * (1 - tLat) * tLon +
          v11 * tLat * tLon;

        const [r, g, b] = colorFn(value);

        // Fill STEP×STEP block
        for (let dy = 0; dy < STEP && py + dy < size.y; dy++) {
          for (let dx = 0; dx < STEP && px + dx < size.x; dx++) {
            const idx = ((py + dy) * size.x + (px + dx)) * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [map, grid, colorFn, valueKey]);

  // Reposition canvas on map move
  useMapEvents({
    move: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
    },
  });

  return null;
}

/** Wind/gust gradient legend bar overlay. */
function WindGradientLegend({ mode }: { mode: 'wind' | 'gusts' }) {
  const isWind = mode === 'wind';
  const stops = isWind
    ? [
        { speed: 0, label: '0' },
        { speed: 5, label: '5' },
        { speed: 10, label: '10' },
        { speed: 15, label: '15' },
        { speed: 20, label: '20' },
        { speed: 25, label: '25' },
        { speed: 30, label: '30' },
        { speed: 35, label: '35+' },
      ]
    : [
        { speed: 0, label: '0' },
        { speed: 10, label: '10' },
        { speed: 15, label: '15' },
        { speed: 20, label: '20' },
        { speed: 30, label: '30' },
        { speed: 40, label: '40+' },
      ];

  const colorFn = isWind ? windSpeedColor : gustSpeedColor;

  // Build CSS gradient
  const gradStops = stops.map(s => colorFn(s.speed)).join(', ');

  return (
    <div className="absolute bottom-3 left-3 right-3 z-[1000]">
      <div className="rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text dark:text-text-dark">
          {isWind ? 'Wind Speed (mph)' : 'Wind Gusts (mph)'}
        </div>
        <div
          className="h-3 w-full rounded-sm"
          style={{ background: `linear-gradient(to right, ${gradStops})` }}
        />
        <div className="mt-0.5 flex justify-between">
          {stops.map((s, i) => (
            <span key={i} className="text-[9px] font-medium text-text-muted dark:text-text-dark-muted">
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Combined wind layer — fetches grid data once, renders heatmap canvas + barb markers.
 * Reused for both wind and gust modes via the `mode` prop.
 */
function WindGustLayer({ lat, lon, mode }: { lat: number; lon: number; mode: 'wind' | 'gusts' }) {
  const map = useMap();
  const markersRef = useRef<L.Marker[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const lastFetchKey = useRef('');
  const [grid, setGrid] = useState<WindGridPoint[]>([]);

  const isWind = mode === 'wind';
  const colorFn = isWind ? windSpeedRGB : gustSpeedRGB;

  const fetchData = useCallback(async () => {
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const { latStep, lonStep } = heatmapGridStep(zoom);

    const n = bounds.getNorth() + latStep;
    const s = bounds.getSouth() - latStep;
    const e = bounds.getEast() + lonStep;
    const w = bounds.getWest() - lonStep;

    const key = `${mode}${n.toFixed(2)},${s.toFixed(2)},${e.toFixed(2)},${w.toFixed(2)},${latStep}`;
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    const lats: number[] = [];
    const lons: number[] = [];
    for (let la = s; la <= n; la += latStep) {
      for (let lo = w; lo <= e; lo += lonStep) {
        lats.push(Math.round(la * 100) / 100);
        lons.push(Math.round(lo * 100) / 100);
      }
    }

    if (lats.length > 300) {
      lats.length = 300;
      lons.length = 300;
    }

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph`;
      const res = await fetch(url, { signal: abortRef.current!.signal });
      if (!res.ok) return;
      const data = await res.json();
      const results: any[] = Array.isArray(data) ? data : [data];

      const points: WindGridPoint[] = results.map((r, i) => ({
        lat: lats[i],
        lon: lons[i],
        speed: r.current?.wind_speed_10m ?? 0,
        gust: r.current?.wind_gusts_10m ?? 0,
        dir: r.current?.wind_direction_10m ?? 0,
      }));

      setGrid(points);

      // --- Render markers at sparser grid ---
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      const { latStep: mLatStep, lonStep: mLonStep } = markerGridStep(zoom);
      const sz = zoom >= 9 ? 48 : zoom >= 7 ? 42 : 36;

      // Snap each marker position to nearest data point
      for (let la = s; la <= n; la += mLatStep) {
        for (let lo = w; lo <= e; lo += mLonStep) {
          // Find closest data point
          let best: WindGridPoint | null = null;
          let bestDist = Infinity;
          for (const p of points) {
            const d = Math.abs(p.lat - la) + Math.abs(p.lon - lo);
            if (d < bestDist) { bestDist = d; best = p; }
          }
          if (!best) continue;

          const val = isWind ? best.speed : best.gust;
          const speedLabel = Math.round(val);

          const icon = L.divIcon({
            className: 'wind-barb',
            html: `<div style="position:relative;width:${sz}px;height:${sz + 14}px;display:flex;flex-direction:column;align-items:center;">
              ${barbSvg(val, best.dir, sz)}
              <span style="font-size:11px;font-weight:700;color:#1e293b;
                text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;
                margin-top:-4px;line-height:1;">${speedLabel}</span>
            </div>`,
            iconSize: [sz, sz + 14],
            iconAnchor: [sz / 2, (sz + 14) / 2],
          });

          const marker = L.marker([best.lat, best.lon], { icon, interactive: false });
          marker.addTo(map);
          markersRef.current.push(marker);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.warn(`${mode} fetch failed:`, err);
    }
  }, [map, mode, isWind]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useMapEvents({
    moveend: fetchData,
    zoomend: fetchData,
  });

  useEffect(() => {
    return () => { markersRef.current.forEach(m => m.remove()); };
  }, []);

  return (
    <WindHeatmapCanvas
      grid={grid}
      colorFn={colorFn}
      valueKey={isWind ? 'speed' : 'gust'}
    />
  );
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
      label: 'Precipitation Intensity',
      items: [
        { color: '#bfffff', label: 'Light' },
        { color: '#6babff', label: 'Moderate' },
        { color: '#0091ca', label: 'Heavy' },
        { color: '#ffee00', label: 'Very Heavy' },
        { color: '#ff9f00', label: 'Intense' },
        { color: '#f23600', label: 'Extreme' },
      ],
    },
    wind: { label: '', items: [] },
    gusts: { label: '', items: [] },
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
          {mode === 'wind' && <WindGustLayer lat={lat} lon={lon} mode="wind" />}
          {mode === 'gusts' && <WindGustLayer lat={lat} lon={lon} mode="gusts" />}
          {mode === 'aqi' && <AQIOverlay lat={lat} lon={lon} />}

          <CenterMarker lat={lat} lon={lon} />
        </MapContainer>

        {(mode === 'wind' || mode === 'gusts') && <WindGradientLegend mode={mode} />}
        {mode !== 'temperature' && mode !== 'wind' && mode !== 'gusts' && <MapLegend mode={mode} />}
      </div>

      {/* Precip 15-day timeline */}
      {mode === 'precipitation' && daily && <PrecipTimeline daily={daily} />}
    </div>
  );
}
