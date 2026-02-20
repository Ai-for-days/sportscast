import type { ForecastPoint, DailyForecast, AirQualityData } from '../../lib/types';
import { windDirectionLabel, parseLocalHour, parseLocalMinute, formatTime } from '../../lib/weather-utils';

interface DetailCardProps {
  title: string;
  icon: string;
  children: React.ReactNode;
}

function DetailCard({ title, icon, children }: DetailCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface/80 p-4 shadow-sm backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-alt/80">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
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
export function UVIndexCard({ current }: { current: ForecastPoint }) {
  const uv = current.uvIndex;
  let level = 'Low';
  let color = '#22c55e';
  if (uv >= 11) { level = 'Extreme'; color = '#7c3aed'; }
  else if (uv >= 8) { level = 'Very High'; color = '#ef4444'; }
  else if (uv >= 6) { level = 'High'; color = '#f97316'; }
  else if (uv >= 3) { level = 'Moderate'; color = '#eab308'; }

  const pct = Math.min(100, (uv / 12) * 100);

  return (
    <DetailCard title="UV Index" icon="☀️">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{uv}</div>
      <div className="text-sm font-medium" style={{ color }}>{level}</div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-green-400 via-yellow-400 via-orange-400 to-purple-500">
        <div className="relative h-full" style={{ width: '100%' }}>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
            style={{ left: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-text-muted dark:text-text-dark-muted">
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
      <div className="flex items-center gap-4">
        {/* Compass */}
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
            {/* Cardinal labels */}
            <text x="50" y="12" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9" fontWeight="bold">N</text>
            <text x="92" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">E</text>
            <text x="50" y="96" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">S</text>
            <text x="8" y="54" textAnchor="middle" className="fill-text-muted dark:fill-text-dark-muted" fontSize="9">W</text>
            {/* Wind direction arrow */}
            <g transform={`rotate(${dir}, 50, 50)`}>
              <line x1="50" y1="20" x2="50" y2="55" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" />
              <polygon points="50,16 44,28 56,28" fill="#3b82f6" />
            </g>
            <circle cx="50" cy="50" r="3" fill="#3b82f6" />
          </svg>
        </div>
        <div>
          <div className="text-2xl font-semibold text-text dark:text-text-dark">{current.windSpeedMph} <span className="text-sm font-normal">mph</span></div>
          <div className="text-sm text-text-muted dark:text-text-dark-muted">Direction: {dir}° {dirLabel}</div>
          <div className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">Gusts: {current.windGustMph} mph</div>
        </div>
      </div>
    </DetailCard>
  );
}

// --- SUNRISE / SUNSET ---
export function SunriseSunsetCard({ today, tomorrow }: { today: DailyForecast; tomorrow?: DailyForecast }) {
  const fmtTime = (timeStr: string | undefined) => {
    if (!timeStr) return '--:--';
    return formatTime(timeStr);
  };

  // Calculate sun position for arc using current browser time
  let sunPct = 0.5;
  if (today.sunrise && today.sunset) {
    const srMin = parseLocalHour(today.sunrise) * 60 + parseLocalMinute(today.sunrise);
    const ssMin = parseLocalHour(today.sunset) * 60 + parseLocalMinute(today.sunset);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const total = ssMin - srMin;
    if (total > 0) {
      sunPct = Math.max(0, Math.min(1, (nowMin - srMin) / total));
    }
  }

  return (
    <DetailCard title="Sunrise & Sunset" icon="🌅">
      {/* Today */}
      <div className="mb-1 text-xs font-semibold text-text dark:text-text-dark">Today</div>
      <div className="relative h-16 w-full">
        <svg viewBox="0 0 200 70" className="h-full w-full">
          <line x1="10" y1="55" x2="190" y2="55" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
          <path d="M 10 55 Q 100 -10 190 55" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" opacity="0.4" />
          {sunPct > 0 && sunPct < 1 && (
            <circle
              cx={10 + sunPct * 180}
              cy={55 - Math.sin(sunPct * Math.PI) * 65}
              r="7"
              fill="#f59e0b"
              className="drop-shadow-sm"
            />
          )}
        </svg>
      </div>
      <div className="flex justify-between text-sm">
        <div>
          <div className="text-xs text-text-muted dark:text-text-dark-muted">Sunrise</div>
          <div className="font-semibold text-text dark:text-text-dark">{fmtTime(today.sunrise)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted dark:text-text-dark-muted">Sunset</div>
          <div className="font-semibold text-text dark:text-text-dark">{fmtTime(today.sunset)}</div>
        </div>
      </div>

      {/* Tomorrow */}
      {tomorrow && (
        <>
          <div className="mb-1 mt-3 border-t border-border pt-2 text-xs font-semibold text-text dark:border-border-dark dark:text-text-dark">Tomorrow</div>
          <div className="relative h-16 w-full">
            <svg viewBox="0 0 200 70" className="h-full w-full">
              <line x1="10" y1="55" x2="190" y2="55" stroke="currentColor" strokeWidth="1" className="text-border dark:text-border-dark" />
              <path d="M 10 55 Q 100 -10 190 55" fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2" opacity="0.3" />
            </svg>
          </div>
          <div className="flex justify-between text-sm">
            <div>
              <div className="text-xs text-text-muted dark:text-text-dark-muted">Sunrise</div>
              <div className="font-semibold text-text dark:text-text-dark">{fmtTime(tomorrow.sunrise)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-muted dark:text-text-dark-muted">Sunset</div>
              <div className="font-semibold text-text dark:text-text-dark">{fmtTime(tomorrow.sunset)}</div>
            </div>
          </div>
        </>
      )}
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
export function VisibilityCard({ current }: { current: ForecastPoint }) {
  let desc = 'Perfectly clear view.';
  if (current.visibility < 2) desc = 'Very poor visibility.';
  else if (current.visibility < 5) desc = 'Moderate visibility.';
  else if (current.visibility < 10) desc = 'Good visibility.';

  return (
    <DetailCard title="Visibility" icon="👁️">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{current.visibility} <span className="text-base font-normal">mi</span></div>
      <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">{desc}</p>
    </DetailCard>
  );
}

// --- HUMIDITY ---
export function HumidityCard({ current }: { current: ForecastPoint }) {
  return (
    <DetailCard title="Humidity" icon="💧">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{current.humidity}%</div>
      <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">
        The dew point is {current.dewPointF}° right now.
      </p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-alt dark:bg-surface-dark">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500 transition-all"
          style={{ width: `${current.humidity}%` }}
        />
      </div>
    </DetailCard>
  );
}

// --- PRESSURE ---
export function PressureCard({ current }: { current: ForecastPoint }) {
  // Convert hPa to inHg
  const inHg = (current.pressure * 0.02953).toFixed(2);
  let trend = 'Steady';
  if (current.pressure > 1020) trend = 'High';
  else if (current.pressure < 1000) trend = 'Low';

  // Gauge visual — normalize between 29.0 and 31.0 inHg
  const val = parseFloat(inHg);
  const pct = Math.max(0, Math.min(100, ((val - 29.0) / 2.0) * 100));

  return (
    <DetailCard title="Pressure" icon="🔵">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{inHg} <span className="text-base font-normal">inHg</span></div>
      <div className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">{trend}</div>
      <div className="relative mt-3">
        <svg viewBox="0 0 200 30" className="h-6 w-full">
          <rect x="0" y="10" width="200" height="8" rx="4" className="fill-surface-alt dark:fill-surface-dark" />
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
        <div className="mt-1 flex justify-between text-[10px] text-text-muted dark:text-text-dark-muted">
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
      <div className="flex items-center gap-4">
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
export function AirQualityCard({ airQuality }: { airQuality?: AirQualityData }) {
  if (!airQuality) {
    return (
      <DetailCard title="Air Quality" icon="🌬️">
        <div className="text-sm text-text-muted dark:text-text-dark-muted">Air quality data unavailable.</div>
      </DetailCard>
    );
  }

  const { aqi, category, description } = airQuality;
  let color = '#22c55e';
  if (aqi > 300) color = '#7f1d1d';
  else if (aqi > 200) color = '#7c3aed';
  else if (aqi > 150) color = '#ef4444';
  else if (aqi > 100) color = '#f97316';
  else if (aqi > 50) color = '#eab308';

  const pct = Math.min(100, (aqi / 300) * 100);

  return (
    <DetailCard title="Air Quality" icon="🌬️">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-text dark:text-text-dark">{aqi}</span>
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
      <p className="mt-2 text-xs text-text-muted dark:text-text-dark-muted">{description}</p>
    </DetailCard>
  );
}

// --- CLOUD COVER ---
export function CloudCoverCard({ current }: { current: ForecastPoint }) {
  let desc = 'Clear skies.';
  if (current.cloudCover > 80) desc = 'Overcast skies.';
  else if (current.cloudCover > 60) desc = 'Mostly cloudy.';
  else if (current.cloudCover > 30) desc = 'Partly cloudy.';
  else if (current.cloudCover > 10) desc = 'A few clouds.';

  return (
    <DetailCard title="Cloud Cover" icon="☁️">
      <div className="text-3xl font-semibold text-text dark:text-text-dark">{current.cloudCover}%</div>
      <p className="mt-2 text-sm text-text-muted dark:text-text-dark-muted">{desc}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-alt dark:bg-surface-dark">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-200 to-gray-400 transition-all"
          style={{ width: `${current.cloudCover}%` }}
        />
      </div>
    </DetailCard>
  );
}
