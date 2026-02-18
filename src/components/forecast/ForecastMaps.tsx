import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type MapMode = 'temperature' | 'precipitation' | 'wind' | 'aqi';

interface Props {
  lat: number;
  lon: number;
}

// --- RainViewer animated precipitation layer ---
function RainViewerLayer() {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        const radarFrames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
        setFrames(radarFrames.map((f: any) => f.path));
      } catch {
        // fallback: no animation
      }
    })();
  }, []);

  useEffect(() => {
    if (frames.length === 0) return;

    const showFrame = (idx: number) => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
      const layer = L.tileLayer(
        `https://tilecache.rainviewer.com${frames[idx]}/256/{z}/{x}/{y}/6/1_1.png`,
        { opacity: 0.6, zIndex: 10 }
      );
      layer.addTo(map);
      layerRef.current = layer;
    };

    showFrame(frameIndex);

    intervalRef.current = setInterval(() => {
      setFrameIndex(prev => {
        const next = (prev + 1) % frames.length;
        showFrame(next);
        return next;
      });
    }, 800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [map, frames]);

  return null;
}

// --- OpenWeatherMap temperature tile layer (free) ---
function TemperatureTileLayer() {
  return (
    <TileLayer
      url="https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=9de243494c0b295cca9337e1e96b00e2"
      opacity={0.5}
      zIndex={10}
    />
  );
}

// --- Wind overlay using OWM tiles ---
function WindAnimatedLayer() {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Use OWM wind speed tiles with periodic refresh for "animation" effect
    const layer = L.tileLayer(
      'https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=9de243494c0b295cca9337e1e96b00e2',
      { opacity: 0.5, zIndex: 10 }
    );
    layer.addTo(map);
    layerRef.current = layer;

    // Pulse opacity for animation effect
    const interval = setInterval(() => {
      setTick(t => {
        const newT = t + 1;
        const opacity = 0.35 + Math.sin(newT * 0.3) * 0.15;
        if (layerRef.current) {
          layerRef.current.setOpacity(opacity);
        }
        return newT;
      });
    }, 200);

    return () => {
      clearInterval(interval);
      if (layerRef.current) map.removeLayer(layerRef.current);
    };
  }, [map]);

  return null;
}

// --- AQI overlay using colored markers ---
function AQIOverlay({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    const fetchAQI = async () => {
      // Generate a grid around the center point
      const step = 1.5;
      const latMin = lat - 5;
      const latMax = lat + 5;
      const lonMin = lon - 8;
      const lonMax = lon + 8;

      const lats: number[] = [];
      const lons: number[] = [];
      for (let la = latMin; la <= latMax; la += step) {
        for (let lo = lonMin; lo <= lonMax; lo += step) {
          lats.push(la);
          lons.push(lo);
        }
      }

      try {
        const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=us_aqi`;
        const res = await fetch(url, { headers: { 'User-Agent': 'SportsCast/1.0' } });
        if (!res.ok) return;
        const data = await res.json();
        const results = Array.isArray(data) ? data : [data];

        // Clear old markers
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
      } catch {
        // silent fail
      }
    };

    fetchAQI();
    return () => {
      markersRef.current.forEach(m => m.remove());
    };
  }, [map, lat, lon]);

  return null;
}

// --- Legend component ---
function MapLegend({ mode }: { mode: MapMode }) {
  const configs: Record<MapMode, { label: string; items: { color: string; label: string }[] }> = {
    temperature: {
      label: 'Temperature (°F)',
      items: [
        { color: '#a855f7', label: '< 32°' },
        { color: '#6366f1', label: '32-50°' },
        { color: '#0ea5e9', label: '50-60°' },
        { color: '#22c55e', label: '60-70°' },
        { color: '#eab308', label: '70-80°' },
        { color: '#f97316', label: '80-90°' },
        { color: '#ef4444', label: '90°+' },
      ],
    },
    precipitation: {
      label: 'Precipitation Radar',
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

// --- Animated badge ---
function AnimatedBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      Live
    </span>
  );
}

export default function ForecastMaps({ lat, lon }: Props) {
  const [mode, setMode] = useState<MapMode>('temperature');

  const tabs: { key: MapMode; label: string; animated: boolean }[] = [
    { key: 'temperature', label: 'Temp', animated: false },
    { key: 'precipitation', label: 'Precip', animated: true },
    { key: 'wind', label: 'Wind', animated: true },
    { key: 'aqi', label: 'AQI', animated: false },
  ];

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
            {tab.animated && <AnimatedBadge />}
          </button>
        ))}
      </div>

      {/* Map */}
      <div className="relative h-[350px] sm:h-[400px]">
        <MapContainer
          key={mode}
          center={[lat, lon]}
          zoom={7}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {mode === 'temperature' && <TemperatureTileLayer />}
          {mode === 'precipitation' && <RainViewerLayer />}
          {mode === 'wind' && <WindAnimatedLayer />}
          {mode === 'aqi' && <AQIOverlay lat={lat} lon={lon} />}

          {/* Center marker */}
          <CenterMarker lat={lat} lon={lon} />
        </MapContainer>

        <MapLegend mode={mode} />
      </div>
    </div>
  );
}

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
