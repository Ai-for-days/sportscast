import type { DailyForecast, ForecastPoint } from '../../lib/types';
import { formatTemp, windDirectionLabel, getWeatherIcon } from '../../lib/weather-utils';
import WeatherIcon from '../WeatherIcon';

interface Props {
  today: DailyForecast;
  current: ForecastPoint;
  hourly?: ForecastPoint[];
}

function buildNext12HoursSummary(hourly: ForecastPoint[]): string {
  if (!hourly || hourly.length < 13) return '';

  const next12 = hourly.slice(1, 13); // next 12 hours (skip current)
  const parts: string[] = [];

  // Temperature range and trend
  const temps = next12.map(h => h.tempF);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const startTemp = hourly[0].tempF;
  const midTemp = next12[5].tempF;
  const endTemp = next12[11].tempF;

  // Describe the temperature journey
  if (startTemp < midTemp && midTemp > endTemp) {
    parts.push(`Temperatures will rise to a high of ${maxTemp}°F then fall back to ${endTemp}°F.`);
  } else if (startTemp > midTemp && midTemp < endTemp) {
    parts.push(`Temperatures will drop to ${minTemp}°F before recovering to ${endTemp}°F.`);
  } else if (endTemp - startTemp >= 8) {
    parts.push(`Temperatures climbing from ${startTemp}°F to ${maxTemp}°F.`);
  } else if (startTemp - endTemp >= 8) {
    parts.push(`Temperatures falling from ${startTemp}°F to ${minTemp}°F.`);
  } else {
    parts.push(`Temperatures holding steady between ${minTemp}°F and ${maxTemp}°F.`);
  }

  // Precipitation analysis
  const precipHours = next12.filter(h => h.precipProbability >= 40);
  const maxPrecipChance = Math.max(...next12.map(h => h.precipProbability));
  if (precipHours.length > 0) {
    const descriptions = next12.map(h => h.description.toLowerCase());
    const hasSnow = descriptions.some(d => d.includes('snow'));
    const hasThunder = descriptions.some(d => d.includes('thunder'));
    const precipType = hasThunder ? 'thunderstorms' : hasSnow ? 'snow' : 'rain';

    if (precipHours.length >= 6) {
      parts.push(`Prolonged ${precipType} expected over the next 12 hours with up to a ${maxPrecipChance}% chance.`);
    } else if (precipHours.length >= 3) {
      parts.push(`${precipType.charAt(0).toUpperCase() + precipType.slice(1)} likely for several hours with a ${maxPrecipChance}% chance.`);
    } else {
      parts.push(`Brief ${precipType} possible with a ${maxPrecipChance}% chance.`);
    }
  }

  // Wind
  const maxGust = Math.max(...next12.map(h => h.windGustMph));
  const avgWind = Math.round(next12.reduce((sum, h) => sum + h.windSpeedMph, 0) / next12.length);
  if (maxGust >= 40) {
    parts.push(`Dangerous wind gusts up to ${maxGust} mph — secure loose objects.`);
  } else if (maxGust >= 25) {
    parts.push(`Gusty winds up to ${maxGust} mph.`);
  } else if (avgWind >= 12) {
    parts.push(`Breezy with sustained winds around ${avgWind} mph.`);
  }

  // Cloud cover trend
  const avgCloud = Math.round(next12.reduce((sum, h) => sum + h.cloudCover, 0) / next12.length);
  if (precipHours.length === 0) {
    if (avgCloud >= 80) {
      parts.push('Overcast skies throughout.');
    } else if (avgCloud >= 50) {
      parts.push('A mix of sun and clouds.');
    } else if (avgCloud >= 20) {
      parts.push('Mostly sunny with some passing clouds.');
    } else {
      parts.push('Clear skies.');
    }
  }

  // Feels like divergence
  const maxFeelsLikeDiff = Math.max(...next12.map(h => Math.abs(h.feelsLikeF - h.tempF)));
  if (maxFeelsLikeDiff >= 8) {
    const humidHour = next12.find(h => h.feelsLikeF - h.tempF >= 8);
    const coldHour = next12.find(h => h.tempF - h.feelsLikeF >= 8);
    if (humidHour) {
      parts.push(`Humidity will make it feel as warm as ${humidHour.feelsLikeF}°F.`);
    } else if (coldHour) {
      parts.push(`Wind chill will make it feel as cold as ${coldHour.feelsLikeF}°F.`);
    }
  }

  // UV warning (daytime hours)
  const maxUV = Math.max(...next12.map(h => h.uvIndex));
  if (maxUV >= 8) {
    parts.push(`Very high UV index of ${maxUV} — sun protection is essential.`);
  } else if (maxUV >= 6) {
    parts.push(`High UV index of ${maxUV} — sunscreen recommended.`);
  }

  return parts.join(' ');
}

export default function TodaysWeather({ today, current, hourly }: Props) {
  const next12Summary = hourly ? buildNext12HoursSummary(hourly) : '';

  if (!next12Summary) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm dark:border-border-dark dark:bg-surface-dark-alt">
      <h3 className="mb-3 text-lg font-semibold text-text dark:text-text-dark">
        In the next 12 hours expect
      </h3>
      <p className="text-sm leading-relaxed text-text-muted dark:text-text-dark-muted">
        {next12Summary}
      </p>
    </div>
  );
}
