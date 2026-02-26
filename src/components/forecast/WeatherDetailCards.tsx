import { useState, useEffect } from 'react';
import type { ForecastPoint, DailyForecast, AirQualityData } from '../../lib/types';
import { windDirectionLabel, parseLocalHour, parseLocalMinute, formatTime, getMoonTimes } from '../../lib/weather-utils';

interface SkyProps {
  skyGradient?: string;
  isLight?: boolean;
}

function skyC(sky?: string, light?: boolean) {
  if (!sky) return {
    text: 'text-text dark:text-text-dark',
    muted: 'text-text-muted dark:text-text-dark-muted',
    border: 'border-border dark:border-border-dark',
    barBg: 'bg-surface-alt dark:bg-surface-dark',
  };
  if (light) return {
    text: 'text-gray-800',
    muted: 'text-gray-600',
    border: 'border-gray-400/30',
    barBg: 'bg-black/10',
  };
  return {
    text: 'text-white',
    muted: 'text-white/70',
    border: 'border-white/20',
    barBg: 'bg-white/20',
  };
}

interface DetailCardProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  skyGradient?: string;
  isLight?: boolean;
}

function DetailCard({ title, icon, children, skyGradient, isLight }: DetailCardProps) {
  const c = skyC(skyGradient, isLight);
  if (skyGradient) {
    return (
      <div className="rounded-2xl p-4 shadow-lg text-center overflow-hidden relative" style={{ background: skyGradient }}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_60%)]" />
        <div className="relative">
          <div className={`mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider ${c.muted}`}>
            <span>{icon}</span>
            <span>{title}</span>
          </div>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-surface/80 p-4 shadow-sm backdrop-blur-sm text-center dark:border-border-dark dark:bg-surface-dark-alt/80">
      <div className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

// --- FEELS LIKE ---
export function FeelsLikeCard({ current }: { current: ForecastPoint }) {
  const diff = current.feelsLikeF - current.tempF;
  let reason = 'Similar to the actual temperature.';
  if (diff <= -5) reason = 'Wind is making it feel cooler.';
  else if (diff >= 5) reason = 'Humidity is making it feel warmer.';

  return (
    <DetailCard title="Feels Like" icon="🌡️">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{current.feelsLikeF}°</div>
      <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">{reason}</p>
    </DetailCard>
  );
}

// --- UV INDEX ---
export function UVIndexCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  const uv = current.uvIndex;
  let level = 'Low';
  let color = '#22c55e';
  if (uv >= 11) { level = 'Extreme'; color = '#7c3aed'; }
  else if (uv >= 8) { level = 'Very High'; color = '#ef4444'; }
  else if (uv >= 6) { level = 'High'; color = '#f97316'; }
  else if (uv >= 3) { level = 'Moderate'; color = '#eab308'; }

  const pct = Math.min(100, (uv / 12) * 100);

  return (
    <DetailCard title="UV Index" icon="☀️" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{uv}</div>
      <div className="text-sm font-medium" style={{ color }}>{level}</div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-green-400 via-yellow-400 via-orange-400 to-purple-500">
        <div className="relative h-full" style={{ width: '100%' }}>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{ left: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <p className={`mt-2 text-xs ${c.muted}`}>
        {uv <= 2 ? 'Low for the rest of the day.' : uv <= 5 ? 'Moderate — wear sunscreen.' : 'High — protection required.'}
      </p>
    </DetailCard>
  );
}

// --- WIND ---
export function WindCard({ current }: { current: ForecastPoint }) {
  const dir = current.windDirectionDeg;
  const dirLabel = windDirectionLabel(dir);

  return (
    <DetailCard title="Wind" icon="💨">
      <div className="flex items-center justify-center gap-3">
        {/* Compass */}
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
            {/* Cardinal labels */}
            <text x="50" y="12" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9" fontWeight="bold">N</text>
            <text x="92" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">E</text>
            <text x="50" y="96" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">S</text>
            <text x="8" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">W</text>
            {/* Wind direction arrow — points where wind is blowing TO (dir + 180) */}
            <g transform={`rotate(${dir + 180}, 50, 50)`}>
              <line x1="50" y1="20" x2="50" y2="55" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
              <polygon points="50,16 44,28 56,28" fill="#3b82f6" />
            </g>
            <circle cx="50" cy="50" r="3" fill="#3b82f6" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold text-text dark:text-text-dark">{current.windSpeedMph} <span className="text-sm font-normal">mph</span></div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">{dir}° {dirLabel}</div>
          <div className="mt-1 text-xs text-text-muted dark:text-text-dark-muted">Gusts: {current.windGustMph} mph</div>
        </div>
      </div>
    </DetailCard>
  );
}

// --- SUN & MOON ---
export function SunriseSunsetCard({ today, tomorrow, lat, lon, utcOffsetSeconds, skyGradient, isLight }: {
  today: DailyForecast;
  tomorrow?: DailyForecast;
  lat: number;
  lon: number;
  utcOffsetSeconds: number;
} & SkyProps) {
  const c = skyC(skyGradient, isLight);
  const fmtTime = (timeStr: string | undefined) => {
    if (!timeStr) return '--:--';
    return formatTime(timeStr);
  };

  // Calculate daylight duration
  let daylightStr = '';
  if (today.sunrise && today.sunset) {
    const srMin = parseLocalHour(today.sunrise) * 60 + parseLocalMinute(today.sunrise);
    const ssMin = parseLocalHour(today.sunset) * 60 + parseLocalMinute(today.sunset);
    const total = ssMin - srMin;
    if (total > 0) {
      const hrs = Math.floor(total / 60);
      const mins = total % 60;
      daylightStr = `${hrs} hrs ${String(mins).padStart(2, '0')} mins`;
    }
  }

  // Time until next sunrise
  let untilSunrise = '';
  if (today.sunrise && tomorrow?.sunrise) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const srMin = parseLocalHour(today.sunrise) * 60 + parseLocalMinute(today.sunrise);
    const ssMin = today.sunset ? parseLocalHour(today.sunset) * 60 + parseLocalMinute(today.sunset) : 1080;

    if (nowMin > ssMin && tomorrow.sunrise) {
      const tomorrowSrMin = parseLocalHour(tomorrow.sunrise) * 60 + parseLocalMinute(tomorrow.sunrise);
      const minsUntil = (1440 - nowMin) + tomorrowSrMin;
      const hrs = Math.floor(minsUntil / 60);
      const mins = minsUntil % 60;
      untilSunrise = `Sunrise in ${hrs}h ${mins}m`;
    } else if (nowMin < srMin) {
      const minsUntil = srMin - nowMin;
      const hrs = Math.floor(minsUntil / 60);
      const mins = minsUntil % 60;
      untilSunrise = `Sunrise in ${hrs}h ${mins}m`;
    }
  }

  // Moon phase calculation
  const KNOWN_NEW_MOON = Date.UTC(2024, 0, 11, 11, 57, 0);
  const SYNODIC_MONTH = 29.53059;
  const nowMs = new Date().getTime();
  const daysSinceRef = (nowMs - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const cycles = daysSinceRef / SYNODIC_MONTH;
  const phaseDay = (cycles - Math.floor(cycles)) * SYNODIC_MONTH;

  let phaseName = 'New Moon';
  let moonIcon = '🌑';
  if (phaseDay < 1.8) { phaseName = 'New Moon'; moonIcon = '🌑'; }
  else if (phaseDay < 7.4) { phaseName = 'Waxing Crescent'; moonIcon = '🌒'; }
  else if (phaseDay < 9.2) { phaseName = 'First Quarter'; moonIcon = '🌓'; }
  else if (phaseDay < 14.8) { phaseName = 'Waxing Gibbous'; moonIcon = '🌔'; }
  else if (phaseDay < 16.6) { phaseName = 'Full Moon'; moonIcon = '🌕'; }
  else if (phaseDay < 22.1) { phaseName = 'Waning Gibbous'; moonIcon = '🌖'; }
  else if (phaseDay < 24.0) { phaseName = 'Last Quarter'; moonIcon = '🌗'; }
  else if (phaseDay < 27.7) { phaseName = 'Waning Crescent'; moonIcon = '🌘'; }
  else { phaseName = 'New Moon'; moonIcon = '🌑'; }

  // Proper astronomical moonrise/moonset calculation
  const dateParts = today.date.split('-').map(Number);
  const moonTimes = getMoonTimes(dateParts[0], dateParts[1], dateParts[2], lat, lon, utcOffsetSeconds);

  const fmtMinutes = (m: number) => {
    if (m < 0) return '--:--';
    const h = Math.floor(m / 60) % 24;
    const min = m % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
  };

  return (
    <DetailCard title="Sun & Moon" icon="🌅" skyGradient={skyGradient} isLight={isLight}>
      {/* Sun section */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-2xl">☀️</span>
        <div className="flex-1">
          {daylightStr && (
            <div className={`text-sm font-medium ${c.text}`}>{daylightStr}</div>
          )}
          {untilSunrise && (
            <div className={`text-xs ${c.muted}`}>{untilSunrise}</div>
          )}
        </div>
        <div className="text-right text-xs">
          <div className={c.muted}>Rise</div>
          <div className={`font-semibold ${c.text}`}>{fmtTime(today.sunrise)}</div>
        </div>
        <div className="text-right text-xs">
          <div className={c.muted}>Set</div>
          <div className={`font-semibold ${c.text}`}>{fmtTime(today.sunset)}</div>
        </div>
      </div>

      {/* Divider */}
      <div className={`my-3 border-t ${c.border}`} />

      {/* Moon section */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-2xl">{moonIcon}</span>
        <div className="flex-1">
          <div className={`text-sm font-medium ${c.text}`}>{phaseName}</div>
        </div>
        <div className="text-right text-xs">
          <div className={c.muted}>Rise</div>
          <div className={`font-semibold ${c.text}`}>{fmtMinutes(moonTimes.rise)}</div>
        </div>
        <div className="text-right text-xs">
          <div className={c.muted}>Set</div>
          <div className={`font-semibold ${c.text}`}>{fmtMinutes(moonTimes.set)}</div>
        </div>
      </div>
    </DetailCard>
  );
}

// --- PRECIPITATION ---
export function PrecipCard({ current, today }: { current: ForecastPoint; today: DailyForecast }) {
  const todayPrecip = today.precipMm;
  const inchesToday = Math.round(todayPrecip * 0.03937 * 100) / 100;

  return (
    <DetailCard title="Precipitation" icon="🌧️">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{inchesToday}" <span className="text-base font-normal">Today</span></div>
      <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">
        {today.precipProbability > 0
          ? `${today.precipProbability}% chance of precipitation today.`
          : 'No precipitation expected today.'}
      </p>
    </DetailCard>
  );
}

// --- VISIBILITY ---
export function VisibilityCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  let desc = 'Perfectly clear view.';
  if (current.visibility < 2) desc = 'Very poor visibility.';
  else if (current.visibility < 5) desc = 'Moderate visibility.';
  else if (current.visibility < 10) desc = 'Good visibility.';

  return (
    <DetailCard title="Visibility" icon="👁️" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{current.visibility} <span className="text-base font-normal">mi</span></div>
      <p className={`mt-2 text-sm ${c.muted}`}>{desc}</p>
    </DetailCard>
  );
}

// --- HUMIDITY ---
export function HumidityCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  return (
    <DetailCard title="Humidity" icon="💧" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{current.humidity}%</div>
      <p className={`mt-2 text-sm ${c.muted}`}>
        The dew point is {current.dewPointF}° right now.
      </p>
      <div className={`mt-3 h-2 w-full overflow-hidden rounded-full ${c.barBg}`}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500 transition-all"
          style={{ width: `${current.humidity}%` }}
        />
      </div>
    </DetailCard>
  );
}

// --- PRESSURE ---
export function PressureCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  // Convert hPa to inHg
  const inHg = (current.pressure * 0.02953).toFixed(2);
  let trend = 'Steady';
  if (current.pressure > 1020) trend = 'High';
  else if (current.pressure < 1000) trend = 'Low';

  // Gauge visual — normalize between 29.0 and 31.0 inHg
  const val = parseFloat(inHg);
  const pct = Math.max(0, Math.min(100, ((val - 29.0) / 2.0) * 100));

  return (
    <DetailCard title="Pressure" icon="🔵" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{inHg} <span className="text-base font-normal">inHg</span></div>
      <div className={`mt-2 text-sm ${c.muted}`}>{trend}</div>
      <div className="relative mt-3">
        <svg viewBox="0 0 200 30" className="h-6 w-full">
          <rect x="0" y="10" width="200" height="8" rx="4"
            fill={skyGradient ? (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)') : undefined}
            className={skyGradient ? undefined : 'fill-surface-alt dark:fill-surface-dark'}
          />
          <rect x="0" y="10" width="200" height="8" rx="4" fill="url(#pressGrad)" />
          <defs>
            <linearGradient id="pressGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#22c55e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
            </linearGradient>
          </defs>
          <circle cx={pct * 2} cy="14" r="6" fill="#3b82f6" stroke="white" strokeWidth="2" />
        </svg>
        <div className={`mt-1 flex justify-between text-[10px] ${c.muted}`}>
          <span>Low</span>
          <span>Normal</span>
          <span>High</span>
        </div>
      </div>
    </DetailCard>
  );
}

// --- MOON PHASE ---
export function MoonPhaseCard() {
  // Calculate moon phase using a known new moon reference point
  // Reference: January 11, 2024 11:57 UTC (verified new moon)
  const KNOWN_NEW_MOON = Date.UTC(2024, 0, 11, 11, 57, 0);
  const SYNODIC_MONTH = 29.53059; // days

  const now = new Date();
  const daysSinceRef = (now.getTime() - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24);
  const cycles = daysSinceRef / SYNODIC_MONTH;
  const phaseDay = (cycles - Math.floor(cycles)) * SYNODIC_MONTH;

  let phaseName = 'New Moon';
  let illumination = 0;
  let moonIcon = '🌑';

  if (phaseDay < 1.8) { phaseName = 'New Moon'; illumination = 0; moonIcon = '🌑'; }
  else if (phaseDay < 5.5) { phaseName = 'Waxing Crescent'; illumination = Math.round((phaseDay / 7.4) * 50); moonIcon = '🌒'; }
  else if (phaseDay < 9.2) { phaseName = 'First Quarter'; illumination = 50; moonIcon = '🌓'; }
  else if (phaseDay < 12.9) { phaseName = 'Waxing Gibbous'; illumination = Math.round(50 + ((phaseDay - 7.4) / 7.4) * 50); moonIcon = '🌔'; }
  else if (phaseDay < 16.6) { phaseName = 'Full Moon'; illumination = 100; moonIcon = '🌕'; }
  else if (phaseDay < 20.3) { phaseName = 'Waning Gibbous'; illumination = Math.round(100 - ((phaseDay - 14.8) / 7.4) * 50); moonIcon = '🌖'; }
  else if (phaseDay < 24.0) { phaseName = 'Last Quarter'; illumination = 50; moonIcon = '🌗'; }
  else if (phaseDay < 27.7) { phaseName = 'Waning Crescent'; illumination = Math.round(50 - ((phaseDay - 22.1) / 7.4) * 50); moonIcon = '🌘'; }
  else { phaseName = 'New Moon'; illumination = 0; moonIcon = '🌑'; }

  const daysToFull = Math.round(14.8 - phaseDay + (phaseDay > 14.8 ? 29.5 : 0));

  return (
    <DetailCard title="Moon" icon="🌙">
      <div className="flex items-center justify-center gap-4">
        <div className="text-5xl">{moonIcon}</div>
        <div>
          <div className="text-lg font-semibold text-text dark:text-text-dark">{phaseName}</div>
          <div className="text-sm text-text-muted dark:text-text-dark-muted">
            Illumination: {illumination}%
          </div>
          <div className="text-sm text-text-muted dark:text-text-dark-muted">
            Next Full Moon: {daysToFull} days
          </div>
        </div>
      </div>
    </DetailCard>
  );
}

// --- AIR QUALITY ---
interface OpenAQResult {
  station: { name: string; distanceMi: number };
  readings: Record<string, { value: number; unit: string; lastUpdated: string }>;
  aqi: number | null;
  lastUpdated: string;
}

function aqiColor(aqi: number): string {
  if (aqi > 300) return '#7f1d1d';
  if (aqi > 200) return '#7c3aed';
  if (aqi > 150) return '#ef4444';
  if (aqi > 100) return '#f97316';
  if (aqi > 50) return '#eab308';
  return '#22c55e';
}

function aqiCategory(aqi: number): string {
  if (aqi > 300) return 'Hazardous';
  if (aqi > 200) return 'Very Unhealthy';
  if (aqi > 150) return 'Unhealthy';
  if (aqi > 100) return 'Unhealthy for Sensitive Groups';
  if (aqi > 50) return 'Moderate';
  return 'Good';
}

export function AirQualityCard({ airQuality, lat, lon, skyGradient, isLight }: { airQuality?: AirQualityData; lat?: number; lon?: number } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  const [epaData, setEpaData] = useState<OpenAQResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lat || !lon) return;
    setLoading(true);
    fetch(`/api/openaq?lat=${lat}&lon=${lon}&radius=15000`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.station && data.aqi !== null) setEpaData(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lat, lon]);

  // Determine which AQI to show — prefer EPA real measurement
  const hasEpa = epaData && epaData.aqi !== null;
  const displayAqi = hasEpa ? epaData!.aqi! : (airQuality?.aqi ?? 0);
  const color = aqiColor(displayAqi);
  const category = hasEpa ? aqiCategory(epaData!.aqi!) : (airQuality?.category ?? 'Unknown');
  const pct = Math.min(100, (displayAqi / 300) * 100);

  if (!airQuality && !hasEpa) {
    return (
      <DetailCard title="Air Quality" icon="🌬️" skyGradient={skyGradient} isLight={isLight}>
        <div className={`text-sm ${c.muted}`}>
          {loading ? 'Loading...' : 'Air quality data unavailable.'}
        </div>
      </DetailCard>
    );
  }

  // Format last updated time
  let timeAgo = '';
  if (hasEpa && epaData!.lastUpdated) {
    const diff = Date.now() - new Date(epaData!.lastUpdated).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 60) timeAgo = `${mins}m ago`;
    else if (mins < 1440) timeAgo = `${Math.round(mins / 60)}h ago`;
    else timeAgo = `${Math.round(mins / 1440)}d ago`;
  }

  return (
    <DetailCard title="Air Quality" icon="🌬️" skyGradient={skyGradient} isLight={isLight}>
      <div className="flex items-baseline justify-center gap-2">
        <span className={`text-3xl font-semibold ${c.text}`}>{displayAqi}</span>
        <span className="text-sm font-medium" style={{ color }}>{category}</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-green-400 via-yellow-400 via-orange-400 via-red-500 to-purple-600">
        <div className="relative h-full" style={{ width: '100%' }}>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{ left: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {hasEpa ? (
        <div className="mt-2">
          <p className={`text-xs ${c.muted}`}>
            <span className="font-semibold text-green-500">EPA measured</span>
            {' '}— {epaData!.station.name} ({epaData!.station.distanceMi} mi away)
          </p>
          {/* Show individual pollutants */}
          <div className={`mt-1.5 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] ${c.muted}`}>
            {epaData!.readings.pm25 && <span>PM2.5: {epaData!.readings.pm25.value} {epaData!.readings.pm25.unit}</span>}
            {epaData!.readings.pm10 && <span>PM10: {epaData!.readings.pm10.value} {epaData!.readings.pm10.unit}</span>}
            {epaData!.readings.o3 && <span>O₃: {epaData!.readings.o3.value} {epaData!.readings.o3.unit}</span>}
            {epaData!.readings.no2 && <span>NO₂: {epaData!.readings.no2.value} {epaData!.readings.no2.unit}</span>}
          </div>
          {timeAgo && <p className={`mt-1 text-[10px] ${c.muted}`}>Updated {timeAgo}</p>}
        </div>
      ) : (
        <p className={`mt-2 text-xs ${c.muted}`}>{airQuality?.description}</p>
      )}
    </DetailCard>
  );
}

// --- DEW POINT ---
export function DewPointCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  const dp = current.dewPointF;
  let comfort = 'Comfortable — dry air.';
  let level = 'Dry';
  if (dp >= 70) { comfort = 'Oppressive — very muggy and uncomfortable.'; level = 'Oppressive'; }
  else if (dp >= 65) { comfort = 'Muggy — uncomfortable for many.'; level = 'Uncomfortable'; }
  else if (dp >= 60) { comfort = 'Humid — starting to feel sticky.'; level = 'Humid'; }
  else if (dp >= 55) { comfort = 'Comfortable with a bit of humidity.'; level = 'Comfortable'; }
  else if (dp >= 40) { comfort = 'Comfortable — pleasant air.'; level = 'Comfortable'; }
  else { comfort = 'Very dry air — moisturize.'; level = 'Very Dry'; }

  const pct = Math.max(0, Math.min(100, ((dp - 20) / 60) * 100));

  return (
    <DetailCard title="Dew Point" icon="💧" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{dp}° <span className="text-base font-normal">{level}</span></div>
      <p className={`mt-2 text-sm ${c.muted}`}>{comfort}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-yellow-300 via-green-400 via-blue-400 to-purple-500">
        <div className="relative h-full" style={{ width: '100%' }}>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow-md bg-blue-500"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
    </DetailCard>
  );
}

// --- CLOUD CEILING ---
export function CloudCeilingCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  // Espy formula: cloud base = ((temp - dewpoint) / 4.4) * 1000 feet
  const spreadF = current.tempF - current.dewPointF;
  const ceilingFt = Math.round((spreadF / 4.4) * 1000);
  const ceilingDisplay = ceilingFt >= 1000 ? `${(ceilingFt / 1000).toFixed(1)}k` : `${ceilingFt}`;

  let desc = 'Very low ceiling — foggy conditions likely.';
  if (ceilingFt >= 12000) desc = 'Unlimited ceiling — excellent visibility aloft.';
  else if (ceilingFt >= 6000) desc = 'High clouds — good flying conditions.';
  else if (ceilingFt >= 3000) desc = 'Moderate ceiling.';
  else if (ceilingFt >= 1000) desc = 'Low ceiling — reduced visibility possible.';

  // For overcast skies, display is meaningful; for clear skies, note it's theoretical
  const isClear = current.cloudCover < 10;

  return (
    <DetailCard title="Cloud Ceiling" icon="⛅" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>
        {isClear ? 'Clear' : `${ceilingDisplay} ft`}
      </div>
      <p className={`mt-2 text-sm ${c.muted}`}>
        {isClear ? 'No significant clouds — unlimited ceiling.' : desc}
      </p>
      {!isClear && (
        <div className={`mt-2 text-xs ${c.muted}`}>
          Est. cloud base: {ceilingFt.toLocaleString()} ft AGL
        </div>
      )}
    </DetailCard>
  );
}

// --- CLOUD COVER ---
export function CloudCoverCard({ current, skyGradient, isLight }: { current: ForecastPoint } & SkyProps) {
  const c = skyC(skyGradient, isLight);
  let desc = 'Clear skies.';
  if (current.cloudCover > 80) desc = 'Overcast skies.';
  else if (current.cloudCover > 60) desc = 'Mostly cloudy.';
  else if (current.cloudCover > 30) desc = 'Partly cloudy.';
  else if (current.cloudCover > 10) desc = 'A few clouds.';

  return (
    <DetailCard title="Cloud Cover" icon="☁️" skyGradient={skyGradient} isLight={isLight}>
      <div className={`text-3xl font-semibold ${c.text}`}>{current.cloudCover}%</div>
      <p className={`mt-2 text-sm ${c.muted}`}>{desc}</p>
      <div className={`mt-3 h-2 w-full overflow-hidden rounded-full ${c.barBg}`}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-200 to-gray-400 transition-all"
          style={{ width: `${current.cloudCover}%` }}
        />
      </div>
    </DetailCard>
  );
}
