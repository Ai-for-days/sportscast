import type { DailyForecast, ForecastPoint } from '../../lib/types';
import { formatTemp, windDirectionLabel, getWeatherIcon } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  today: DailyForecast;
  current: ForecastPoint;
}

function buildDayNarrative(today: DailyForecast, current: ForecastPoint): string {
  const parts: string[] = [];
  const desc = today.description.toLowerCase();

  // Sky condition opener
  if (desc.includes('blizzard')) {
    parts.push(`Blizzard conditions expected with heavy snow, high winds, and dangerously low visibility. Avoid travel.`);
  } else if (desc.includes('thunder') || desc.includes('storm')) {
    parts.push(`Thunderstorms are expected today.`);
  } else if (desc.includes('rain') || desc.includes('shower') || desc.includes('drizzle')) {
    if (today.precipProbability >= 70) {
      parts.push(`Rain is likely today with a ${today.precipProbability}% chance of precipitation.`);
    } else {
      parts.push(`Showers are possible today with a ${today.precipProbability}% chance of precipitation.`);
    }
  } else if (desc.includes('heavy snow')) {
    parts.push(`Heavy snow expected today with significant accumulations possible.`);
  } else if (desc.includes('snow')) {
    parts.push(`Snow is expected today with accumulations possible.`);
  } else if (desc.includes('fog')) {
    parts.push(`Foggy conditions are expected, especially during the morning hours.`);
  } else if (desc.includes('overcast')) {
    parts.push(`Overcast skies are expected throughout the day.`);
  } else if (desc.includes('mostly cloudy')) {
    parts.push(`Expect mostly cloudy skies today.`);
  } else if (desc.includes('partly')) {
    parts.push(`Partly sunny skies are expected today.`);
  } else if (desc.includes('mostly clear')) {
    parts.push(`Mostly clear skies with plenty of sunshine today.`);
  } else {
    parts.push(`Clear skies and sunshine are expected today.`);
  }

  // Temperature context
  const high = today.highF;
  const low = today.lowF;
  if (high >= 95) {
    parts.push(`Dangerously hot with a high of ${high}°F.`);
  } else if (high >= 85) {
    parts.push(`Warm with a high near ${high}°F.`);
  } else if (high >= 70) {
    parts.push(`Pleasant temperatures with a high of ${high}°F.`);
  } else if (high >= 55) {
    parts.push(`Cool with a high near ${high}°F.`);
  } else if (high >= 40) {
    parts.push(`Chilly with a high of only ${high}°F.`);
  } else {
    parts.push(`Cold with a high of ${high}°F.`);
  }

  // Feels like
  if (Math.abs(today.feelsLikeHighF - high) >= 5) {
    if (today.feelsLikeHighF > high) {
      parts.push(`Humidity will make it feel like ${today.feelsLikeHighF}°F.`);
    } else {
      parts.push(`Wind will make it feel more like ${today.feelsLikeHighF}°F.`);
    }
  }

  // Wind
  if (today.windGustMph >= 35) {
    parts.push(`Strong winds with gusts up to ${today.windGustMph} mph from the ${windDirectionLabel(current.windDirectionDeg)}.`);
  } else if (today.windGustMph >= 20) {
    parts.push(`Breezy at times with gusts to ${today.windGustMph} mph.`);
  } else if (today.windSpeedMph >= 10) {
    parts.push(`Light winds from the ${windDirectionLabel(current.windDirectionDeg)} at ${today.windSpeedMph} mph.`);
  }

  // Humidity
  if (today.humidity >= 80 && high >= 75) {
    parts.push(`High humidity will add to the discomfort.`);
  } else if (today.humidity <= 25) {
    parts.push(`Very low humidity — stay hydrated.`);
  }

  // UV
  if (today.uvIndexMax >= 8) {
    parts.push(`UV index is very high at ${today.uvIndexMax} — sun protection is essential.`);
  } else if (today.uvIndexMax >= 6) {
    parts.push(`UV index is high at ${today.uvIndexMax} — sunscreen recommended.`);
  }

  return parts.join(' ');
}

function buildNightNarrative(today: DailyForecast): string {
  const parts: string[] = [];
  const desc = today.description.toLowerCase();

  if (desc.includes('blizzard')) {
    parts.push(`Blizzard conditions continuing overnight with dangerous wind chills.`);
  } else if (desc.includes('thunder') || desc.includes('storm')) {
    parts.push(`Thunderstorms possible overnight.`);
  } else if (desc.includes('rain') || desc.includes('shower') || desc.includes('drizzle')) {
    parts.push(`Rain may continue into the evening hours.`);
  } else if (desc.includes('heavy snow')) {
    parts.push(`Heavy snow continuing overnight with additional accumulations.`);
  } else if (desc.includes('snow')) {
    parts.push(`Snow showers possible overnight.`);
  } else if (desc.includes('overcast') || desc.includes('mostly cloudy')) {
    parts.push(`Mostly cloudy skies tonight.`);
  } else if (desc.includes('partly')) {
    parts.push(`Partly cloudy tonight.`);
  } else {
    parts.push(`Clear skies tonight.`);
  }

  const low = today.lowF;
  if (low <= 25) {
    parts.push(`Very cold with an overnight low of ${low}°F. Bundle up if heading out.`);
  } else if (low <= 32) {
    parts.push(`Temperatures dropping to a cold ${low}°F overnight with possible frost.`);
  } else if (low <= 45) {
    parts.push(`Chilly with an overnight low near ${low}°F.`);
  } else if (low >= 75) {
    parts.push(`A warm night with lows only dropping to ${low}°F.`);
  } else {
    parts.push(`Overnight low of ${low}°F.`);
  }

  if (today.windGustMph >= 25) {
    parts.push(`Winds may remain gusty overnight.`);
  }

  return parts.join(' ');
}

export default function TodaysWeather({ today, current }: Props) {
  const dayNarrative = buildDayNarrative(today, current);
  const nightNarrative = buildNightNarrative(today);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Today's Weather</h3>
        <span className="text-sm text-text-muted dark:text-text-dark-muted">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="space-y-4">
        {/* Daytime */}
        <div className="text-center">
          <div className="mb-2 flex justify-center"><WeatherIcon icon={today.icon} size={64} /></div>
          <div className="mb-1 flex items-center justify-center gap-2">
            <span className="text-sm font-semibold text-text dark:text-text-dark">Day</span>
            <span className="text-sm font-bold text-text dark:text-text-dark">
              {formatTemp(today.highF)}
            </span>
            {today.precipProbability > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400">
                {today.precipProbability}% precip
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
            {dayNarrative}
          </p>
        </div>

        <div className="border-t border-border/50 dark:border-border-dark/50" />

        {/* Tonight */}
        <div className="text-center">
          <div className="mb-2 flex justify-center"><WeatherIcon icon={getWeatherIcon(today.description, true)} size={64} /></div>
          <div className="mb-1 flex items-center justify-center gap-2">
            <span className="text-sm font-semibold text-text dark:text-text-dark">Tonight</span>
            <span className="text-sm font-bold text-text dark:text-text-dark">
              {formatTemp(today.lowF)}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
            {nightNarrative}
          </p>
        </div>
      </div>
    </div>
  );
}
