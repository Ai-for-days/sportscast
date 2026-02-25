import type { DailyForecast } from '../../lib/types';
import { formatTemp, formatDate } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  today: DailyForecast;
  tomorrow: DailyForecast;
}

function buildTomorrowDayNarrative(tomorrow: DailyForecast, today: DailyForecast): string {
  const parts: string[] = [];
  const desc = tomorrow.description.toLowerCase();
  const tempDiff = tomorrow.highF - today.highF;

  // Temperature trend vs today
  if (tempDiff <= -10) {
    parts.push(`Much colder than today with a high of ${tomorrow.highF}°F, down ${Math.abs(tempDiff)} degrees.`);
  } else if (tempDiff <= -5) {
    parts.push(`Cooler than today with a high near ${tomorrow.highF}°F.`);
  } else if (tempDiff >= 10) {
    parts.push(`Much warmer than today with a high reaching ${tomorrow.highF}°F.`);
  } else if (tempDiff >= 5) {
    parts.push(`Warmer than today with a high near ${tomorrow.highF}°F.`);
  } else {
    parts.push(`Temperatures similar to today with a high of ${tomorrow.highF}°F.`);
  }

  // Sky conditions
  if (desc.includes('thunder') || desc.includes('storm')) {
    parts.push(`Thunderstorms are expected, so plan accordingly.`);
  } else if (desc.includes('rain') || desc.includes('shower') || desc.includes('drizzle')) {
    if (tomorrow.precipProbability >= 70) {
      parts.push(`Rain is likely with a ${tomorrow.precipProbability}% chance of precipitation. Bring an umbrella.`);
    } else {
      parts.push(`There is a ${tomorrow.precipProbability}% chance of showers.`);
    }
  } else if (desc.includes('snow')) {
    parts.push(`Snow is in the forecast. Travel may be impacted.`);
  } else if (desc.includes('overcast')) {
    parts.push(`Expect overcast skies throughout the day.`);
  } else if (desc.includes('mostly cloudy')) {
    parts.push(`Mostly cloudy skies are expected.`);
  } else if (desc.includes('partly')) {
    parts.push(`Look for a mix of sun and clouds.`);
  } else {
    parts.push(`Sunny skies are expected.`);
  }

  // Feels like
  if (Math.abs(tomorrow.feelsLikeHighF - tomorrow.highF) >= 5) {
    if (tomorrow.feelsLikeHighF > tomorrow.highF) {
      parts.push(`It will feel like ${tomorrow.feelsLikeHighF}°F with the humidity.`);
    } else {
      parts.push(`Wind chill will make it feel more like ${tomorrow.feelsLikeHighF}°F.`);
    }
  }

  // Wind
  if (tomorrow.windGustMph >= 35) {
    parts.push(`Watch for strong wind gusts up to ${tomorrow.windGustMph} mph.`);
  } else if (tomorrow.windGustMph >= 20) {
    parts.push(`Breezy with gusts to ${tomorrow.windGustMph} mph.`);
  }

  return parts.join(' ');
}

function buildTomorrowNightNarrative(tomorrow: DailyForecast): string {
  const parts: string[] = [];
  const desc = tomorrow.description.toLowerCase();

  if (desc.includes('rain') || desc.includes('shower') || desc.includes('thunder')) {
    parts.push(`Rain or storms may linger into the evening.`);
  } else if (desc.includes('overcast') || desc.includes('mostly cloudy')) {
    parts.push(`Cloudy skies continue into the night.`);
  } else if (desc.includes('partly')) {
    parts.push(`Partly cloudy skies overnight.`);
  } else {
    parts.push(`Mainly clear overnight.`);
  }

  const low = tomorrow.lowF;
  if (low <= 32) {
    parts.push(`Cold with a low of ${low}°F — frost is likely.`);
  } else if (low <= 50) {
    parts.push(`Cool with an overnight low of ${low}°F.`);
  } else if (low >= 75) {
    parts.push(`Warm with a low of only ${low}°F.`);
  } else {
    parts.push(`Overnight low around ${low}°F.`);
  }

  return parts.join(' ');
}

export default function TomorrowOutlook({ today, tomorrow }: Props) {
  if (!tomorrow) return null;

  const dayNarrative = buildTomorrowDayNarrative(tomorrow, today);
  const nightNarrative = buildTomorrowNightNarrative(tomorrow);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text dark:text-text-dark">Looking Ahead — Tomorrow</h3>
        <span className="text-sm text-text-muted dark:text-text-dark-muted">
          {formatDate(tomorrow.date)}
        </span>
      </div>

      <div className="space-y-4">
        {/* Tomorrow daytime */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0"><WeatherIcon icon={tomorrow.icon} size={28} /></span>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-text dark:text-text-dark">Day</span>
              <span className="text-sm font-bold text-text dark:text-text-dark">
                {formatTemp(tomorrow.highF)} / {formatTemp(tomorrow.lowF)}
              </span>
              {tomorrow.precipProbability > 0 && (
                <span className="text-xs text-blue-600 dark:text-blue-400">
                  {tomorrow.precipProbability}% precip
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
              {tomorrow.dayDescription || dayNarrative}
            </p>
          </div>
        </div>

        <div className="border-t border-border/50 dark:border-border-dark/50" />

        {/* Tomorrow night */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-xl">🌙</span>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-text dark:text-text-dark">Night</span>
              <span className="text-sm font-bold text-text dark:text-text-dark">
                {formatTemp(tomorrow.lowF)}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
              {tomorrow.nightDescription || nightNarrative}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
