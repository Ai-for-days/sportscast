import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import type { MapGridPoint } from '../../lib/types';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
import L from 'leaflet';

const defaultIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="width:8px;height:8px;background:#22c55e;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

interface ClickedPoint {
  lat: number;
  lon: number;
  tempF?: number;
  loading?: boolean;
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function GridOverlay({ points, overlay }: { points: MapGridPoint[]; overlay: string }) {
  const map = useMap();

  useEffect(() => {
    const markers: L.CircleMarker[] = [];

    points.forEach(pt => {
      let color = '#22c55e';
      let radius = 6;

      if (overlay === 'temperature') {
        if (pt.tempF >= 100) color = '#ef4444';
        else if (pt.tempF >= 90) color = '#f97316';
        else if (pt.tempF >= 80) color = '#eab308';
        else if (pt.tempF >= 70) color = '#22c55e';
        else if (pt.tempF >= 60) color = '#0ea5e9';
        else if (pt.tempF >= 50) color = '#6366f1';
        else if (pt.tempF >= 32) color = '#8b5cf6';
        else color = '#a855f7';
      } else if (overlay === 'precipitation') {
        if (pt.precipMm <= 0) { color = 'transparent'; radius = 0; }
        else if (pt.precipMm < 1) color = '#93c5fd';
        else if (pt.precipMm < 3) color = '#3b82f6';
        else color = '#1d4ed8';
      } else if (overlay === 'wind') {
        if (pt.windSpeedMph < 10) color = '#22c55e';
        else if (pt.windSpeedMph < 20) color = '#eab308';
        else if (pt.windSpeedMph < 30) color = '#f97316';
        else color = '#ef4444';
        radius = Math.min(12, 4 + pt.windSpeedMph / 5);
      }

      if (radius > 0) {
        const marker = L.circleMarker([pt.lat, pt.lon], {
          radius,
          fillColor: color,
          color: 'transparent',
          fillOpacity: 0.6,
        }).bindTooltip(
          overlay === 'temperature' ? `${pt.tempF}°F` :
          overlay === 'precipitation' ? `${pt.precipMm}mm` :
          `${pt.windSpeedMph}mph`,
          { direction: 'top', offset: [0, -8] }
        );
        marker.addTo(map);
        markers.push(marker);
      }
    });

    return () => {
      markers.forEach(m => m.remove());
    };
  }, [map, points, overlay]);

  return null;
}

export default function WeatherMap() {
  const [overlay, setOverlay] = useState<'temperature' | 'precipitation' | 'wind'>('temperature');
  const [gridPoints, setGridPoints] = useState<MapGridPoint[]>([]);
  const [clickedPoint, setClickedPoint] = useState<ClickedPoint | null>(null);
  const [clickedForecast, setClickedForecast] = useState<any>(null);

  const fetchGrid = useCallback(async () => {
    try {
      const res = await fetch('/api/map-grid?north=50&south=24&east=-66&west=-125');
      if (res.ok) {
        const data = await res.json();
        setGridPoints(data);
      }
    } catch {
      console.error('Failed to fetch map grid');
    }
  }, []);

  useEffect(() => {
    fetchGrid();
  }, [fetchGrid]);

  const handleMapClick = async (lat: number, lng: number) => {
    setClickedPoint({ lat, lon: lng, loading: true });
    setClickedForecast(null);

    try {
      const res = await fetch(`/api/forecast?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&days=1`);
      if (res.ok) {
        const data = await res.json();
        setClickedForecast(data);
        setClickedPoint({ lat, lon: lng, tempF: data.current.tempF });
      }
    } catch {
      setClickedPoint({ lat, lon: lng });
    }
  };

  const legendItems = overlay === 'temperature'
    ? [
        { color: '#a855f7', label: '< 32°F' },
        { color: '#8b5cf6', label: '32-50°F' },
        { color: '#6366f1', label: '50-60°F' },
        { color: '#0ea5e9', label: '60-70°F' },
        { color: '#22c55e', label: '70-80°F' },
        { color: '#eab308', label: '80-90°F' },
        { color: '#f97316', label: '90-100°F' },
        { color: '#ef4444', label: '100°F+' },
      ]
    : overlay === 'precipitation'
    ? [
        { color: '#93c5fd', label: '< 1mm' },
        { color: '#3b82f6', label: '1-3mm' },
        { color: '#1d4ed8', label: '3mm+' },
      ]
    : [
        { color: '#22c55e', label: '< 10 mph' },
        { color: '#eab308', label: '10-20 mph' },
        { color: '#f97316', label: '20-30 mph' },
        { color: '#ef4444', label: '30+ mph' },
      ];

  return (
    <div className="relative h-full w-full">
      {/* Controls */}
      <div className="absolute left-4 top-4 z-[1000] flex gap-1 rounded-lg border border-border bg-surface p-1 shadow-lg dark:border-border-dark dark:bg-surface-dark-alt">
        {(['temperature', 'precipitation', 'wind'] as const).map(o => (
          <button
            key={o}
            onClick={() => setOverlay(o)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              overlay === o
                ? 'bg-field text-white'
                : 'text-text-muted hover:bg-surface-alt dark:text-text-dark-muted dark:hover:bg-surface-dark'
            }`}
          >
            {o}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-8 left-4 z-[1000] rounded-lg border border-border bg-surface/95 p-3 shadow-lg backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/95">
        <div className="mb-1 text-xs font-semibold capitalize text-text dark:text-text-dark">{overlay}</div>
        <div className="space-y-1">
          {legendItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-text-muted dark:text-text-dark-muted">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <MapContainer
        center={[39, -98]}
        zoom={4}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onMapClick={handleMapClick} />
        <GridOverlay points={gridPoints} overlay={overlay} />

        {clickedPoint && (
          <Marker position={[clickedPoint.lat, clickedPoint.lon]} icon={defaultIcon}>
            <Popup>
              <div className="min-w-48 text-sm">
                {clickedPoint.loading ? (
                  <p>Loading forecast...</p>
                ) : clickedForecast ? (
                  <div>
                    <div className="mb-1 text-sm font-semibold text-gray-800">
                      {clickedForecast.location?.displayName || `${clickedPoint.lat.toFixed(2)}, ${clickedPoint.lon.toFixed(2)}`}
                    </div>
                    <div className="mb-1 text-lg font-bold">
                      {clickedForecast.current.icon} {clickedForecast.current.tempF}°F
                    </div>
                    <p>{clickedForecast.current.description}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      Wind: {clickedForecast.current.windSpeedMph} mph |
                      Humidity: {clickedForecast.current.humidity}%
                    </p>
                    <a
                      href={`/forecast/${clickedPoint.lat.toFixed(4)},${clickedPoint.lon.toFixed(4)}`}
                      className="mt-2 inline-block text-xs font-medium text-green-600 hover:underline"
                    >
                      View full forecast →
                    </a>
                  </div>
                ) : (
                  <p>Loading location...</p>
                )}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
