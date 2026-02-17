import type { ForecastPoint, ForecastResponse, EnsembleForecast, DailyForecast, GeoLocation, MapGridPoint } from './types';
import { feelsLike, describeWeather, getWeatherIcon, reverseGeocode } from './weather-utils';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function generateHourlyForecast(lat: number, lon: number, days: number): ForecastPoint[] {
  const rng = seededRandom(Math.floor(lat * 1000 + lon * 100));
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const points: ForecastPoint[] = [];

  // Base temp varies by latitude (rough US approximation)
  const baseTemp = 75 - Math.abs(lat - 33) * 1.5;
  // Season adjustment
  const month = now.getMonth();
  const seasonOffset = Math.cos((month - 6) / 12 * 2 * Math.PI) * 15;

  for (let h = 0; h < days * 24; h++) {
    const time = new Date(now.getTime() + h * 3600000);
    const hour = time.getHours();

    // Diurnal cycle
    const diurnal = -Math.cos((hour - 14) / 24 * 2 * Math.PI) * 12;
    const variation = (rng() - 0.5) * 8;
    const tempF = Math.round(baseTemp + seasonOffset + diurnal + variation);

    const humidity = Math.round(40 + rng() * 40 + (tempF < 50 ? 15 : 0));
    const cloudCover = Math.round(rng() * 100);
    const precipProbability = cloudCover > 60 ? Math.round((cloudCover - 60) * 2.5 * rng()) : Math.round(rng() * 10);
    const precipMm = precipProbability > 40 ? Math.round(rng() * 5 * 10) / 10 : 0;
    const windBase = 5 + rng() * 15;
    const windSpeedMph = Math.round(windBase + (rng() - 0.5) * 5);
    const windGustMph = Math.round(windSpeedMph * (1.3 + rng() * 0.4));
    const windDirectionDeg = Math.round(rng() * 360);
    const isNight = hour < 6 || hour > 20;
    const description = describeWeather(tempF, humidity, precipProbability, windSpeedMph, cloudCover);

    points.push({
      time: time.toISOString(),
      tempK: (tempF - 32) * 5 / 9 + 273.15,
      tempF,
      tempC: Math.round((tempF - 32) * 5 / 9),
      humidity,
      precipMm,
      precipProbability,
      windSpeedMph,
      windDirectionDeg,
      windGustMph,
      cloudCover,
      pressure: Math.round(1013 + (rng() - 0.5) * 20),
      feelsLikeF: feelsLike(tempF, humidity, windSpeedMph),
      uvIndex: isNight ? 0 : Math.round(rng() * 10),
      visibility: Math.round(8 + rng() * 7),
      description,
      icon: getWeatherIcon(description, isNight),
    });
  }

  return points;
}

function hourlyToDailyForecasts(hourly: ForecastPoint[]): DailyForecast[] {
  const dayMap = new Map<string, ForecastPoint[]>();
  for (const pt of hourly) {
    const dateKey = pt.time.slice(0, 10);
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
    dayMap.get(dateKey)!.push(pt);
  }

  const daily: DailyForecast[] = [];
  for (const [date, pts] of dayMap) {
    if (pts.length < 12) continue; // skip partial days
    const temps = pts.map(p => p.tempF);
    const maxPrecipProb = Math.max(...pts.map(p => p.precipProbability));
    const totalPrecip = pts.reduce((s, p) => s + p.precipMm, 0);
    const avgWind = Math.round(pts.reduce((s, p) => s + p.windSpeedMph, 0) / pts.length);
    const maxGust = Math.max(...pts.map(p => p.windGustMph));
    const avgHumidity = Math.round(pts.reduce((s, p) => s + p.humidity, 0) / pts.length);

    // Use midday conditions for description
    const midday = pts.find(p => new Date(p.time).getHours() === 12) || pts[Math.floor(pts.length / 2)];

    daily.push({
      date,
      highF: Math.max(...temps),
      lowF: Math.min(...temps),
      precipMm: Math.round(totalPrecip * 10) / 10,
      precipProbability: maxPrecipProb,
      windSpeedMph: avgWind,
      windGustMph: maxGust,
      humidity: avgHumidity,
      description: midday.description,
      icon: midday.icon,
    });
  }
  return daily;
}

export async function getMockForecast(lat: number, lon: number, days: number = 15): Promise<ForecastResponse> {
  const hourly = generateHourlyForecast(lat, lon, days);
  const daily = hourlyToDailyForecasts(hourly);
  const current = hourly[0];
  const geo = await reverseGeocode(lat, lon);

  return {
    location: {
      lat,
      lon,
      name: geo.name,
      displayName: geo.displayName,
      state: geo.state,
      country: geo.country,
    },
    current,
    hourly,
    daily,
    generatedAt: new Date().toISOString(),
  };
}

export function getMockEnsembleForecast(lat: number, lon: number, startTime: string, endTime: string): EnsembleForecast[] {
  const rng = seededRandom(Math.floor(lat * 1000 + lon * 100 + 42));
  const start = new Date(startTime);
  const end = new Date(endTime);
  const points: EnsembleForecast[] = [];

  const baseTemp = 75 - Math.abs(lat - 33) * 1.5;
  const month = start.getMonth();
  const seasonOffset = Math.cos((month - 6) / 12 * 2 * Math.PI) * 15;

  for (let t = start.getTime(); t <= end.getTime(); t += 3600000) {
    const time = new Date(t);
    const hour = time.getHours();
    const diurnal = -Math.cos((hour - 14) / 24 * 2 * Math.PI) * 12;
    const medianTemp = Math.round(baseTemp + seasonOffset + diurnal);
    const spread = 2 + rng() * 6; // ensemble spread increases with time

    const medianPrecip = rng() > 0.7 ? rng() * 3 : 0;
    const medianWind = Math.round(8 + rng() * 10);

    points.push({
      time: time.toISOString(),
      median: { tempF: medianTemp, precipMm: Math.round(medianPrecip * 10) / 10, windSpeedMph: medianWind },
      p10: { tempF: Math.round(medianTemp - spread * 1.5), precipMm: 0, windSpeedMph: Math.round(medianWind * 0.6) },
      p25: { tempF: Math.round(medianTemp - spread * 0.7), precipMm: Math.round(medianPrecip * 0.3 * 10) / 10, windSpeedMph: Math.round(medianWind * 0.8) },
      p75: { tempF: Math.round(medianTemp + spread * 0.7), precipMm: Math.round(medianPrecip * 1.8 * 10) / 10, windSpeedMph: Math.round(medianWind * 1.2) },
      p90: { tempF: Math.round(medianTemp + spread * 1.5), precipMm: Math.round(medianPrecip * 3 * 10) / 10, windSpeedMph: Math.round(medianWind * 1.5) },
      precipProbability: medianPrecip > 0 ? Math.round(30 + rng() * 50) : Math.round(rng() * 20),
    });
  }

  return points;
}

export async function getMockHistorical(lat: number, lon: number, date: string): Promise<ForecastResponse> {
  return getMockForecast(lat, lon, 1);
}

export function getMockMapGrid(north: number, south: number, east: number, west: number): MapGridPoint[] {
  const rng = seededRandom(Math.floor(north * 100 + west * 50));
  const points: MapGridPoint[] = [];
  const step = 2; // 2-degree grid

  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
      const baseTemp = 75 - Math.abs(lat - 33) * 1.5;
      const variation = (rng() - 0.5) * 10;
      points.push({
        lat,
        lon,
        tempF: Math.round(baseTemp + variation),
        precipMm: rng() > 0.7 ? Math.round(rng() * 5 * 10) / 10 : 0,
        windSpeedMph: Math.round(5 + rng() * 20),
        windDirectionDeg: Math.round(rng() * 360),
      });
    }
  }

  return points;
}
